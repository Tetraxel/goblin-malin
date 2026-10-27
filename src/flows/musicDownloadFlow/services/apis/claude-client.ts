import { spawn } from "child_process";
import os from "os";
import { globalLogger } from "#base/logger/logger";
import { Semaphore } from "#utils/semaphore";

/**
 * Thin wrapper around the Claude Code CLI in headless mode (`claude -p`), so the app can use the
 * user's own Claude plan as an AI backend without an API key. The app never sees credentials: the
 * CLI is the user's own install, already logged in, and every call is spent from their own quota.
 *
 * Design notes (measured against claude 2.1.x):
 *  • A bare `claude -p` loads the full Claude Code system prompt (~50k tokens, ~4s). We replace it
 *    (`--system-prompt`) and switch off settings/MCP/slash-commands, which brings a call down to
 *    ~1.4k tokens. This matters: it is the user's subscription quota.
 *  • Prompt goes over stdin (no arg-length / quoting problems), the answer comes back as JSON with a
 *    schema-validated `structured_output`.
 *  • Runs from the OS temp dir so no project CLAUDE.md / settings are picked up.
 *  • Web research is slow (tens of seconds, a dozen turns), hence the semaphore, the timeout and
 *    the quota cooldown below — callers should treat this as a last resort, not a hot path.
 *
 * This is the shared entry point for every Claude-backed feature (discovery today; picking the best
 * source, fixing metadata and building MusicBrainz releases later).
 */

export type ClaudeErrorCode =
    | "not-installed"
    | "not-logged-in"
    | "quota"
    | "timeout"
    | "aborted"
    | "failed"
    | "bad-output";

export class ClaudeCliError extends Error {
    constructor(
        public readonly code: ClaudeErrorCode,
        message: string
    ) {
        super(message);
        this.name = "ClaudeCliError";
    }
}

export const CLAUDE_MODELS = ["haiku", "sonnet", "opus", "fable"] as const;
export const DEFAULT_CLAUDE_MODEL = "sonnet";
export const DEFAULT_CLAUDE_COMMAND = "claude";

const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_PARALLEL_CALLS = 2;
// After the plan's usage limit is hit every further call would fail the same way and just burn
// ~seconds of process startup per task, so refuse fast for a while.
const QUOTA_COOLDOWN_MS = 10 * 60_000;

export interface ClaudeRunOptions {
    prompt: string;
    systemPrompt: string;
    /** Alias ("sonnet", "opus", …) or full model name. */
    model: string;
    /** JSON Schema the answer must satisfy. */
    jsonSchema: object;
    /** Built-in Claude Code tools the agent may use without asking, e.g. ["WebSearch", "WebFetch"]. */
    tools?: string[];
    /** Executable to run; defaults to "claude" on PATH. */
    command?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
}

export interface ClaudeRunResult<T> {
    data: T;
    durationMs: number;
    turns: number;
    /** Notional list-price cost reported by the CLI (not what a subscription is charged). */
    costUsd?: number;
}

/** CLI arguments for a headless, structured, minimal-context call. Exported for testing. */
export function buildClaudeArgs(opts: ClaudeRunOptions): string[] {
    const tools = opts.tools ?? [];
    const args = [
        "-p",
        "--output-format",
        "json",
        "--model",
        opts.model,
        "--no-session-persistence",
        "--disable-slash-commands",
        "--setting-sources",
        "",
        "--strict-mcp-config",
        "--system-prompt",
        opts.systemPrompt,
        "--tools",
        tools.join(","),
    ];
    // Headless mode can't ask for permission, so the tools we hand out are pre-approved.
    if (tools.length > 0) args.push("--allowedTools", ...tools);
    args.push("--json-schema", JSON.stringify(opts.jsonSchema));
    return args;
}

interface CliEnvelope {
    is_error?: boolean;
    subtype?: string;
    result?: string;
    structured_output?: unknown;
    duration_ms?: number;
    num_turns?: number;
    total_cost_usd?: number;
}

function classifyFailure(text: string): ClaudeErrorCode {
    if (/not logged in|please run \/login|invalid api key|authentication|unauthori[sz]ed|credit balance/i.test(text)) {
        return "not-logged-in";
    }
    if (/usage limit|limit reached|rate limit|quota|too many requests|resets? (at|in)/i.test(text)) return "quota";
    return "failed";
}

/** Parses the CLI's JSON envelope into the schema-validated answer. Exported for testing. */
export function parseClaudeOutput<T>(stdout: string): ClaudeRunResult<T> {
    let envelope: CliEnvelope;
    try {
        envelope = JSON.parse(stdout) as CliEnvelope;
    } catch {
        throw new ClaudeCliError("bad-output", `Claude returned non-JSON output: ${stdout.slice(0, 200)}`);
    }

    if (envelope.is_error || (envelope.subtype && envelope.subtype !== "success")) {
        const text = envelope.result ?? envelope.subtype ?? "unknown error";
        throw new ClaudeCliError(classifyFailure(text), `Claude failed: ${text}`.slice(0, 300));
    }

    let data: unknown = envelope.structured_output;
    if (data === undefined && typeof envelope.result === "string") {
        // Defensive: some versions only fill `result`, possibly inside a ```json fence.
        const unfenced = envelope.result.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "");
        try {
            data = JSON.parse(unfenced);
        } catch {
            /* handled below */
        }
    }
    if (data === undefined || data === null) {
        throw new ClaudeCliError("bad-output", "Claude returned no structured answer");
    }

    return {
        data: data as T,
        durationMs: envelope.duration_ms ?? 0,
        turns: envelope.num_turns ?? 0,
        costUsd: envelope.total_cost_usd,
    };
}

export class ClaudeClient {
    // Process-wide so the cap and the cooldown hold across every parallel task.
    private static limiter = new Semaphore(MAX_PARALLEL_CALLS);
    private static blockedUntil = 0;
    private readonly logger = globalLogger.createChild({ service: "ClaudeClient" });

    async run<T>(opts: ClaudeRunOptions): Promise<ClaudeRunResult<T>> {
        return ClaudeClient.limiter.run(async () => {
            if (opts.signal?.aborted) throw new ClaudeCliError("aborted", "Aborted before starting");
            if (Date.now() < ClaudeClient.blockedUntil) {
                const until = new Date(ClaudeClient.blockedUntil).toLocaleTimeString();
                throw new ClaudeCliError("quota", `Claude usage limit hit recently; not retrying before ${until}`);
            }

            try {
                const stdout = await this.exec(opts);
                const result = parseClaudeOutput<T>(stdout);
                this.logger.info(
                    `Claude call done in ${(result.durationMs / 1000).toFixed(1)}s, ${result.turns} turn(s)` +
                        (result.costUsd !== undefined ? `, ~$${result.costUsd.toFixed(3)} list price` : "")
                );
                return result;
            } catch (error) {
                if (error instanceof ClaudeCliError && error.code === "quota") {
                    ClaudeClient.blockedUntil = Date.now() + QUOTA_COOLDOWN_MS;
                }
                throw error;
            }
        });
    }

    private exec(opts: ClaudeRunOptions): Promise<string> {
        const command = opts.command?.trim() || DEFAULT_CLAUDE_COMMAND;
        const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

        return new Promise<string>((resolve, reject) => {
            const child = spawn(command, buildClaudeArgs(opts), {
                cwd: os.tmpdir(),
                windowsHide: true,
                stdio: ["pipe", "pipe", "pipe"],
            });

            let stdout = "";
            let stderr = "";
            let settled = false;
            const finish = (fn: () => void) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                opts.signal?.removeEventListener("abort", onAbort);
                fn();
            };

            const timer = setTimeout(() => {
                child.kill();
                finish(() =>
                    reject(new ClaudeCliError("timeout", `Claude did not answer within ${timeoutMs / 1000}s`))
                );
            }, timeoutMs);

            const onAbort = () => {
                child.kill();
                finish(() => reject(new ClaudeCliError("aborted", "Aborted")));
            };
            opts.signal?.addEventListener("abort", onAbort, { once: true });

            child.stdout.setEncoding("utf-8").on("data", (chunk: string) => (stdout += chunk));
            child.stderr.setEncoding("utf-8").on("data", (chunk: string) => (stderr += chunk));

            child.on("error", (error: NodeJS.ErrnoException) => {
                // ENOENT: not on PATH. EINVAL: Windows refuses to spawn .cmd/.bat shims directly.
                const missing = error.code === "ENOENT" || error.code === "EINVAL";
                finish(() =>
                    reject(
                        new ClaudeCliError(
                            missing ? "not-installed" : "failed",
                            missing
                                ? `Claude Code CLI not found ("${command}"). Install it and log in, or set its full path in Settings.`
                                : `Could not start Claude: ${error.message}`
                        )
                    )
                );
            });

            child.on("close", (code) => {
                finish(() => {
                    // A failing run still prints its JSON envelope on stdout; prefer that over stderr.
                    if (stdout.trim()) return resolve(stdout);
                    const detail = stderr.trim() || `exit code ${code}`;
                    reject(new ClaudeCliError(classifyFailure(detail), `Claude failed: ${detail}`.slice(0, 300)));
                });
            });

            child.stdin.on("error", () => {
                /* the process exited before reading the prompt; "close" reports the real error */
            });
            child.stdin.end(opts.prompt);
        });
    }
}
