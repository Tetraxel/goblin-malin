import { spawn } from "node:child_process";
import { registerAgentCleanup } from "#base/agent/cleanup";
import { ClaudeCliError, classifyFailure } from "./claude-client";
import { isShellScript, resolveCliCommand } from "./resolveCliCommand";
import { claudeWorkDir } from "#utils/claudeWorkDir";

/**
 * Runs ONE message of the chat through the user's own Claude Code CLI (`claude -p`), streaming what it does.
 * Distinct from `ClaudeClient` (the discovery fallback): that one runs with no tools but web search and one JSON
 * answer; this one runs with NO built-in tool at all and only the app's own MCP tools, and keeps its conversation so
 * the next message can resume it.
 *
 * What makes it safe to hand the CLI the app's data:
 *  - `--tools ""` turns off every built-in tool (no shell, no file access, no web) and `--setting-sources ""` ignores
 *    the user's own settings, hooks and plugins;
 *  - `--strict-mcp-config` + `--mcp-config` give it exactly one server: the one inside this app;
 *  - `--allowedTools` lists the app's tools by name. An allowlist, not a denylist: a tool the CLI adds in a later
 *    version is not covered by anything we forgot to deny.
 *
 * The bearer token never goes on the command line (other local processes can read it): the config file names an
 * environment variable and the child gets the value in its environment.
 */

export const MCP_SERVER_NAME = "goblin";
export const TOKEN_ENV_VAR = "GOBLIN_AGENT_TOKEN";

/**
 * How long the CLI lets one tool call take (`MCP_TOOL_TIMEOUT`, in ms). Its default is 60 s, and a call may
 * legitimately take longer: a dialog waiting for the user, `wait_for_tasks`. When it cuts a call, the model sees "The
 * operation timed out" and tries again, which would ask the user the same question twice. Kept just under the
 * limit of the whole run (`DEFAULT_TIMEOUT_MS`).
 */
export const MCP_TOOL_TIMEOUT_MS = 9 * 60_000;
const DEFAULT_TIMEOUT_MS = 10 * 60_000;
// How much of the CLI's stderr is kept for an error message.
const MAX_STDERR_CHARS = 16_000;
/**
 * A guard against a runaway loop of tool calls, not a bill (a subscription is not charged per call; this is the CLI's
 * own notional list-price figure). A normal message costs a few cents.
 */
export const MAX_MESSAGE_BUDGET_USD = 2;

/** The name the CLI gives an MCP tool: `mcp__<server>__<tool>`. */
export const cliToolName = (tool: string): string => `mcp__${MCP_SERVER_NAME}__${tool}`;
/** The app's name for a tool the CLI reported (`mcp__goblin__select_source` → `select_source`). */
export const appToolName = (cliName: string): string => cliName.replace(new RegExp(`^mcp__${MCP_SERVER_NAME}__`), "");

/** The contents of the `--mcp-config` file: one HTTP server, its token read from the child's environment. */
export function buildMcpConfig(url: string): string {
    return JSON.stringify({
        mcpServers: {
            [MCP_SERVER_NAME]: {
                type: "http",
                url,
                headers: { Authorization: `Bearer \${${TOKEN_ENV_VAR}}` },
            },
        },
    });
}

export interface AgentArgsOptions {
    model: string;
    systemPrompt: string;
    mcpConfigPath: string;
    /** The app's tool names (without the `mcp__` prefix). */
    tools: string[];
    sessionId: string;
    /** Continue the conversation `sessionId` instead of starting it. */
    resume: boolean;
}

/** CLI arguments for one chat message. Exported for testing. */
export function buildAgentArgs(opts: AgentArgsOptions): string[] {
    return [
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--model",
        opts.model,
        "--max-budget-usd",
        String(MAX_MESSAGE_BUDGET_USD),
        // Resuming needs the session to be kept (no `--no-session-persistence`): the consent says so.
        opts.resume ? "--resume" : "--session-id",
        opts.sessionId,
        "--disable-slash-commands",
        "--setting-sources",
        "",
        "--tools",
        "",
        "--strict-mcp-config",
        "--mcp-config",
        opts.mcpConfigPath,
        "--allowedTools",
        ...opts.tools.map(cliToolName),
        "--system-prompt",
        opts.systemPrompt,
    ];
}

// ── What the CLI streams back ─────────────────────────────────────────────

export type AgentCliEvent =
    | { type: "session"; sessionId: string }
    /** A piece of the answer as it is written (`--include-partial-messages`). */
    | { type: "text-delta"; text: string }
    /** A whole text block of the answer; only used when no pieces arrived (an older CLI). */
    | { type: "assistant-text"; text: string }
    | { type: "tool-use"; id: string; name: string; input: unknown }
    | { type: "tool-result"; id: string; isError: boolean; /** What the tool answered, as text. */ output?: string }
    /** How much of the plan's 5-hour and 7-day windows is used (the CLI reports it with every message). */
    | { type: "quota"; windows: QuotaWindows }
    | {
          type: "result";
          ok: boolean;
          text: string;
          sessionId?: string;
          costUsd?: number;
          turns?: number;
          durationMs?: number;
      };

/** One usage window of the plan: the share used (0–1) and when it resets (epoch milliseconds). */
export type QuotaWindow = { utilization: number; resetsAt: number };
export type QuotaWindows = { fiveHour?: QuotaWindow; sevenDay?: QuotaWindow };

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | undefined =>
    v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : undefined;

function quotaWindow(value: unknown): QuotaWindow | undefined {
    const w = obj(value);
    if (!w || typeof w.utilization !== "number" || typeof w.resetsAt !== "number") return undefined;
    if (!Number.isFinite(w.utilization) || !Number.isFinite(w.resetsAt) || w.resetsAt <= 0) return undefined;
    // A share (0.41), though a CLI that reports percent (41) is read as well.
    const share = w.utilization > 1 ? w.utilization / 100 : w.utilization;
    // `resetsAt` is in epoch seconds.
    return { utilization: Math.min(1, Math.max(0, share)), resetsAt: w.resetsAt * 1000 };
}

/** The plan's windows out of a `rate_limit_event`'s info (none when it carries neither). */
export function parseQuotaWindows(info: unknown): QuotaWindows | undefined {
    const windows = obj(obj(info)?.unifiedWindows);
    const fiveHour = quotaWindow(windows?.five_hour);
    const sevenDay = quotaWindow(windows?.seven_day);
    return fiveHour || sevenDay ? { ...(fiveHour ? { fiveHour } : {}), ...(sevenDay ? { sevenDay } : {}) } : undefined;
}

/** The text of a tool result: a string, or a list of blocks of which the text ones are joined. */
function toolResultText(content: unknown): string | undefined {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return undefined;
    const texts = content.flatMap((block) => {
        const b = obj(block);
        return b?.type === "text" && typeof b.text === "string" ? [b.text] : [];
    });
    return texts.length > 0 ? texts.join("\n") : undefined;
}

/** Turns one line of the CLI's `stream-json` output into events (none for a line that is not one we use). */
export function parseAgentStreamLine(line: string): AgentCliEvent[] {
    let json: Json | undefined;
    try {
        json = obj(JSON.parse(line));
    } catch {
        return [];
    }
    if (!json) return [];

    switch (json.type) {
        case "system":
            return json.subtype === "init" && typeof json.session_id === "string"
                ? [{ type: "session", sessionId: json.session_id }]
                : [];
        case "rate_limit_event": {
            const windows = parseQuotaWindows(json.rate_limit_info);
            return windows ? [{ type: "quota", windows }] : [];
        }
        case "stream_event": {
            const delta = obj(obj(json.event)?.delta);
            return delta?.type === "text_delta" && typeof delta.text === "string"
                ? [{ type: "text-delta", text: delta.text }]
                : [];
        }
        case "assistant": {
            const content = obj(json.message)?.content;
            if (!Array.isArray(content)) return [];
            const events: AgentCliEvent[] = [];
            for (const block of content) {
                const b = obj(block);
                if (b?.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string") {
                    events.push({ type: "tool-use", id: b.id, name: appToolName(b.name), input: b.input });
                } else if (b?.type === "text" && typeof b.text === "string") {
                    events.push({ type: "assistant-text", text: b.text });
                }
            }
            return events;
        }
        case "user": {
            const content = obj(json.message)?.content;
            if (!Array.isArray(content)) return [];
            return content.flatMap((block): AgentCliEvent[] => {
                const b = obj(block);
                if (b?.type !== "tool_result" || typeof b.tool_use_id !== "string") return [];
                const output = toolResultText(b.content);
                return [
                    {
                        type: "tool-result",
                        id: b.tool_use_id,
                        isError: b.is_error === true,
                        ...(output !== undefined ? { output } : {}),
                    },
                ];
            });
        }
        case "result":
            return [
                {
                    type: "result",
                    ok: json.is_error !== true && (json.subtype === undefined || json.subtype === "success"),
                    // A run stopped by a limit (budget, turns) carries no text, only its subtype.
                    text:
                        typeof json.result === "string" && json.result
                            ? json.result
                            : json.is_error === true || (json.subtype !== undefined && json.subtype !== "success")
                              ? `the run ended: ${typeof json.subtype === "string" ? json.subtype : "error"}`
                              : "",
                    sessionId: typeof json.session_id === "string" ? json.session_id : undefined,
                    costUsd: typeof json.total_cost_usd === "number" ? json.total_cost_usd : undefined,
                    turns: typeof json.num_turns === "number" ? json.num_turns : undefined,
                    durationMs: typeof json.duration_ms === "number" ? json.duration_ms : undefined,
                },
            ];
        default:
            return [];
    }
}

/** Splits a stream of text chunks into lines (a line may arrive in pieces). */
export function createLineSplitter(onLine: (line: string) => void): { push: (chunk: string) => void; end: () => void } {
    let buffer = "";
    return {
        push(chunk) {
            buffer += chunk;
            let newline: number;
            while ((newline = buffer.indexOf("\n")) !== -1) {
                const line = buffer.slice(0, newline).trim();
                buffer = buffer.slice(newline + 1);
                if (line) onLine(line);
            }
        },
        end() {
            const line = buffer.trim();
            buffer = "";
            if (line) onLine(line);
        },
    };
}

export interface RunAgentCliOptions {
    command: string;
    args: string[];
    /** The message, sent on stdin (no length or quoting problem on a command line). */
    prompt: string;
    /** The bearer token, given to the child as an environment variable. */
    token: string;
    signal: AbortSignal;
    onEvent: (event: AgentCliEvent) => void;
    timeoutMs?: number;
}

/**
 * Runs the CLI for one message and resolves when it has exited. Rejects with a {@link ClaudeCliError}: not installed,
 * not logged in, quota, timeout, aborted, or failed. Events are delivered as they stream in.
 */
export async function runAgentCli(opts: RunAgentCliOptions): Promise<void> {
    const command = opts.command.trim() || "claude";
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const cwd = await claudeWorkDir();

    return new Promise<void>((resolve, reject) => {
        if (opts.signal.aborted) return reject(new ClaudeCliError("aborted", "Stopped"));
        // On Windows an npm install is a `.cmd` shim Node cannot start: run what the shim runs.
        const { file, prefixArgs } = resolveCliCommand(command);
        const child = spawn(file, [...prefixArgs, ...opts.args], {
            cwd,
            env: { ...process.env, [TOKEN_ENV_VAR]: opts.token, MCP_TOOL_TIMEOUT: String(MCP_TOOL_TIMEOUT_MS) },
            windowsHide: true,
            stdio: ["pipe", "pipe", "pipe"],
        });

        let stderr = "";
        let sawResult = false;
        let lastResultError = "";
        let resultFailed = false;
        let settled = false;

        const forgetCleanup = registerAgentCleanup(() => void child.kill());
        const finish = (fn: () => void) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            opts.signal.removeEventListener("abort", onAbort);
            forgetCleanup();
            fn();
        };
        const timer = setTimeout(() => {
            child.kill();
            finish(() =>
                reject(new ClaudeCliError("timeout", `Claude did not finish within ${timeoutMs / 60_000} minutes`))
            );
        }, timeoutMs);
        const onAbort = () => {
            child.kill();
            finish(() => reject(new ClaudeCliError("aborted", "Stopped")));
        };
        opts.signal.addEventListener("abort", onAbort, { once: true });

        const lines = createLineSplitter((line) => {
            for (const event of parseAgentStreamLine(line)) {
                if (event.type === "result") {
                    sawResult = true;
                    if (!event.ok) {
                        resultFailed = true;
                        lastResultError = event.text;
                    }
                }
                opts.onEvent(event);
            }
        });
        child.stdout.setEncoding("utf-8").on("data", (chunk: string) => lines.push(chunk));
        // Only its end is kept: it is read for an error message, and a chatty CLI must not grow it for ten minutes.
        child.stderr.setEncoding("utf-8").on("data", (chunk: string) => {
            stderr = (stderr + chunk).slice(-MAX_STDERR_CHARS);
        });

        child.on("error", (error: NodeJS.ErrnoException) => {
            const unrunnableShim = error.code === "EINVAL" && isShellScript(file);
            const missing = error.code === "ENOENT" || error.code === "EINVAL";
            const message = unrunnableShim
                ? `Claude Code CLI ("${file}") is a Windows .cmd script that cannot be started directly. In Settings, set the full path of claude.exe (native install) or of the cli.js it runs.`
                : missing
                  ? `Claude Code CLI not found ("${command}"). Install it and log in, or set its full path in Settings.`
                  : `Could not start Claude: ${error.message}`;
            finish(() => reject(new ClaudeCliError(missing ? "not-installed" : "failed", message)));
        });

        child.on("close", (code) => {
            lines.end();
            finish(() => {
                if (sawResult && !resultFailed) return resolve();
                const detail = lastResultError || stderr.trim() || `exit code ${code}`;
                reject(
                    new ClaudeCliError(
                        classifyFailure(detail, lastResultError ? "cli-result" : "stderr"),
                        `Claude failed: ${detail}`.slice(0, 300)
                    )
                );
            });
        });

        child.stdin.on("error", () => {
            /* the process exited before reading the prompt; "close" reports the real error */
        });
        child.stdin.end(opts.prompt);
    });
}
