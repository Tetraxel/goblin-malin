import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { globalLogger } from "#base/logger/logger";
import { agentToolRegistry } from "#base/agent/agentToolRegistry";
import { type AgentTurn } from "#base/agent/agentTurn";
import { ClaudeCliError, ClaudeClient } from "../services/apis/claude-client";
import {
    buildAgentArgs,
    buildMcpConfig,
    runAgentCli,
    type AgentCliEvent,
    type RunAgentCliOptions,
} from "../services/apis/claude-agent-client";
import { getAgentSettings } from "./agentSettings";
import { ensureAgentConsent } from "./consent";
import { AGENT_SYSTEM_PROMPT, selectionHeader } from "./agentPrompt";
import { agentRuntime, type AgentRuntime } from "./agentRuntime";
import { agentJournal } from "./taskAccess";
import { chatStore, type ChatStore } from "./chatStore";
import { claudeQuota } from "./claudeQuota";
import { registerAgentTools } from "./registerAgentTools";
import { runAllowance } from "./runAllowance";
import { agentLog, type AgentLogWriter } from "./agentLog";
import { claudeWorkDir } from "#utils/claudeWorkDir";
import { loadChatHistory, saveChatHistory, summarizeSavedChat, type SavedChatSummary } from "./chatHistory";

const logger = globalLogger.createChild({ service: "AgentChat" });

/** Slash commands the chat understands itself (they never reach Claude). */
export const CHAT_COMMANDS = { undo: "/undo", new: "/new" } as const;

export type AgentChatDeps = {
    runtime?: AgentRuntime;
    store?: ChatStore;
    /** Swapped for a fake in tests. */
    runCli?: (opts: RunAgentCliOptions) => Promise<void>;
    /** Where everything said and every tool call is logged (`agent.log`; a fake in tests). */
    log?: AgentLogWriter;
    /** Where the last conversation is kept (swapped for a fake in tests; defaults to the app's data folder). */
    history?: {
        save: typeof saveChatHistory;
        load: typeof loadChatHistory;
    };
};

function describeFailure(error: ClaudeCliError): string {
    switch (error.code) {
        case "not-installed":
            return error.message;
        case "not-logged-in":
            return "The Claude CLI is not logged in. Run `claude` once in a terminal and log in.";
        case "quota":
            return "Your Claude plan's usage limit is reached. Try again later.";
        case "timeout":
            return "Claude took too long and was stopped.";
        case "aborted":
            return "Stopped.";
        default:
            return error.message;
    }
}

/**
 * The conversation with Claude: one message = one run of the CLI, resumed from the previous one. The CLI is started
 * with only the app's tools; the tools are served by the MCP server in this process (see `agentRuntime`).
 */
export class AgentChat {
    private readonly runtime: AgentRuntime;
    private readonly store: ChatStore;
    private readonly runCli: (opts: RunAgentCliOptions) => Promise<void>;
    private readonly history: NonNullable<AgentChatDeps["history"]>;
    private readonly log: AgentLogWriter;
    private sessionId: string = randomUUID();
    // The CLI has seen this session (it answered with its `init`): the next message resumes it.
    private sessionStarted = false;
    private current?: { turn: AgentTurn; token: string };
    // Set from the moment a message is accepted (the consent question may take a while): a second one is ignored.
    private sending = false;

    constructor(deps: AgentChatDeps = {}) {
        this.runtime = deps.runtime ?? agentRuntime;
        this.store = deps.store ?? chatStore;
        this.runCli = deps.runCli ?? runAgentCli;
        this.history = deps.history ?? { save: saveChatHistory, load: loadChatHistory };
        this.log = deps.log ?? agentLog;
    }

    // What the chat shows as a note or an error is logged too.
    private note(text: string): void {
        this.log.write({ kind: "note", text });
        this.store.addNote(text);
    }

    private fail(text: string): void {
        this.log.write({ kind: "error", text });
        this.store.addError(text);
    }

    get busy(): boolean {
        return this.sending;
    }

    /**
     * Sends one message. `selectedTaskIds` is what the user has selected in the app right now: it goes in as a short
     * header, so "fix these titles" means something. Resolves when Claude has finished (or was stopped).
     */
    async send(text: string, selectedTaskIds: readonly string[] = []): Promise<void> {
        const message = text.trim();
        if (message === "" || this.busy) return;
        if (message === CHAT_COMMANDS.undo) return this.undo();
        if (message === CHAT_COMMANDS.new) return this.newConversation();

        this.sending = true;
        // The message is shown (and the panel busy) before anything can refuse it: a declined consent or a quota
        // cooldown leaves the text in the chat next to the reason, never gone, and a second Enter is not dropped.
        this.store.addUser(message);
        this.store.setBusy(true);
        try {
            if (!(await ensureAgentConsent())) {
                this.note("Claude is switched off. Allow it in Settings → Claude agent (chat).");
                return;
            }
            const waitUntil = ClaudeClient.quotaBlockedUntil();
            if (Date.now() < waitUntil) {
                this.fail(
                    `Claude's usage limit was reached. Not trying again before ${new Date(waitUntil).toLocaleTimeString()}.`
                );
                return;
            }

            registerAgentTools();
            this.log.write({
                kind: "user",
                text: message,
                prompt: selectionHeader(selectedTaskIds) + message,
                selectedTaskIds: [...selectedTaskIds],
            });
            this.store.setActivity("Thinking…");
            await this.runTurn(selectionHeader(selectedTaskIds) + message, true);
        } finally {
            this.store.setBusy(false);
            this.sending = false;
            // Kept for "reopen": only once the CLI knows the session (there is something to resume).
            if (this.sessionStarted) {
                await this.history.save({ sessionId: this.sessionId, messages: this.store.getSnapshot().messages });
            }
        }
    }

    /** What the last saved conversation is (for the "reopen" button), or undefined when there is none. */
    async lastConversation(): Promise<SavedChatSummary | undefined> {
        const saved = await this.history.load();
        return saved ? summarizeSavedChat(saved) : undefined;
    }

    /**
     * Brings the last conversation back, and Claude's memory of it: the next message resumes its session. Only into
     * an empty chat, so nothing the user is reading is replaced. Resolves whether it did.
     */
    async reopenLast(): Promise<boolean> {
        if (this.busy || this.store.getSnapshot().messages.length > 0) return false;
        const saved = await this.history.load();
        if (!saved) return false;
        this.sessionId = saved.sessionId;
        this.sessionStarted = true;
        runAllowance.reset();
        this.store.restore(saved.messages);
        return true;
    }

    /** The user pressed Stop: the CLI is killed and the turn's tools stop. */
    stop(): void {
        this.current?.turn.stop();
    }

    /** Reverts Claude's last change, unless the task changed since (then it says so and does nothing). */
    async undo(): Promise<void> {
        let result: Awaited<ReturnType<typeof agentJournal.undoLast>>;
        try {
            result = await agentJournal.undoLast();
        } catch (error) {
            // Ctrl+Z works while Claude answers: a refusal must reach the chat, never be a silent rejection.
            logger.warn("Undo failed", { error });
            this.note(`Could not undo: ${error instanceof Error ? error.message : "it failed"}.`);
            return;
        }
        if (result.done) this.note(`Undone: ${result.entry.label}`);
        else if (result.reason === "nothing") this.note("Nothing to undo.");
        else if (result.reason === "changed") {
            this.note(
                `Cannot undo "${result.entry?.label}": ${result.taskId} was changed since. Undoing would erase that change.`
            );
        } else if (result.reason === "busy") {
            this.note(
                `Cannot undo "${result.entry?.label}" yet: ${result.taskId} is being worked on right now. Try again when it is done.`
            );
        } else this.note(`Cannot undo "${result.entry?.label}": the task is gone.`);
    }

    /**
     * Forgets the conversation: the next message starts a new Claude session. The chat goes back to its empty state
     * (which is the sign of it: the model can be chosen again, and the last conversation can be reopened).
     */
    newConversation(): void {
        if (this.busy) return;
        this.sessionId = randomUUID();
        this.sessionStarted = false;
        runAllowance.reset();
        this.store.clear();
    }

    private async runTurn(prompt: string, mayRetryFresh: boolean): Promise<void> {
        const settings = getAgentSettings();
        // Before the turn begins: a folder that cannot be made (read-only data folder, full disk) must fail the message,
        // not leave a started turn that nothing ever ends.
        let workDir: string;
        try {
            workDir = await claudeWorkDir();
        } catch (error) {
            this.fail(`Could not prepare the Claude work folder: ${error instanceof Error ? error.message : error}`);
            return;
        }
        let started: { turn: AgentTurn; token: string };
        try {
            started = await this.runtime.beginTurn();
        } catch (error) {
            this.fail(error instanceof Error ? error.message : "Could not start");
            return;
        }
        this.current = started;
        const { turn, token } = started;
        turn.onProgress = (text) => this.store.setActivity(text);

        const configPath = path.join(workDir, `goblin-agent-${randomBytes(6).toString("hex")}.json`);
        let streamedText = false;
        let resumeFailed = false;
        let retryFresh = false;
        const tools = new Map<string, { name: string; at: number }>();
        const resume = this.sessionStarted;
        const turnStartedAt = Date.now();
        this.log.write({
            kind: "turn-start",
            turn: turn.id,
            model: settings.model,
            session: this.sessionId,
            resume,
            tools: agentToolRegistry.list().length,
        });
        // What Claude says is logged whole: the pieces it streams are gathered and written when it moves on to
        // something else (a tool call, the end of the turn).
        let spoken = "";
        const flushSpoken = () => {
            if (spoken.trim() !== "") this.log.write({ kind: "assistant", turn: turn.id, text: spoken });
            spoken = "";
        };

        const onEvent = (event: AgentCliEvent) => {
            switch (event.type) {
                case "session":
                    this.sessionStarted = true;
                    this.sessionId = event.sessionId;
                    this.log.write({ kind: "session", turn: turn.id, session: event.sessionId });
                    break;
                case "text-delta":
                    streamedText = true;
                    spoken += event.text;
                    this.store.setActivity("Writing…");
                    this.store.appendAssistant(event.text);
                    break;
                case "assistant-text":
                    // Only when nothing streamed in pieces (the same text would show twice otherwise).
                    if (!streamedText) {
                        this.log.write({ kind: "assistant", turn: turn.id, text: event.text });
                        this.store.addAssistant(event.text);
                    }
                    break;
                case "tool-use": {
                    const tool = agentToolRegistry.get(event.name);
                    let label = event.name;
                    try {
                        label = tool?.describeCall?.(event.input ?? {}) ?? event.name;
                    } catch {
                        /* a label is never worth failing for */
                    }
                    flushSpoken();
                    tools.set(event.id, { name: event.name, at: Date.now() });
                    this.log.write({
                        kind: "tool-call",
                        turn: turn.id,
                        id: event.id,
                        tool: event.name,
                        input: event.input,
                    });
                    this.store.setActivity(label);
                    this.store.addTool(event.id, label, event.input);
                    break;
                }
                case "tool-result": {
                    const call = tools.get(event.id);
                    this.log.write({
                        kind: "tool-result",
                        turn: turn.id,
                        id: event.id,
                        tool: call?.name,
                        isError: event.isError,
                        ms: call ? Date.now() - call.at : undefined,
                        output: event.output,
                    });
                    this.store.finishTool(event.id, event.isError, event.output);
                    this.store.setActivity("Thinking…");
                    break;
                }
                case "quota":
                    claudeQuota.update(event.windows);
                    break;
                case "result":
                    flushSpoken();
                    this.log.write({
                        kind: "result",
                        turn: turn.id,
                        ok: event.ok,
                        costUsd: event.costUsd,
                        turns: event.turns,
                        durationMs: event.durationMs,
                        ...(event.ok ? {} : { text: event.text }),
                    });
                    this.store.addUsage(event.costUsd, event.turns);
                    if (!event.ok && /no conversation found/i.test(event.text)) resumeFailed = true;
                    // Nothing streamed and no text block either: the final text is all there is.
                    if (event.ok && !streamedText && event.text.trim()) this.store.addAssistant(event.text);
                    break;
            }
        };

        try {
            // New file, readable by the user alone: it names the loopback address of this turn's tool server.
            await fs.writeFile(configPath, buildMcpConfig(this.runtime.url), {
                encoding: "utf8",
                flag: "wx",
                mode: 0o600,
            });
            await this.runCli({
                command: settings.command,
                args: buildAgentArgs({
                    model: settings.model,
                    systemPrompt: AGENT_SYSTEM_PROMPT,
                    mcpConfigPath: configPath,
                    tools: agentToolRegistry.list().map((t) => t.name),
                    sessionId: this.sessionId,
                    resume,
                }),
                prompt,
                token,
                signal: turn.signal,
                onEvent,
            });
        } catch (error) {
            if (error instanceof ClaudeCliError) {
                if (error.code === "quota") ClaudeClient.noteQuotaHit();
                // The session files are gone (the user cleared Claude's history): start over once, keeping this message.
                if (resume && (resumeFailed || /no conversation found/i.test(error.message)) && mayRetryFresh) {
                    logger.info("Claude does not know the previous session any more: starting a new one");
                    this.sessionId = randomUUID();
                    this.sessionStarted = false;
                    this.note("Claude lost the earlier conversation; starting a new one.");
                    // The retry starts once this turn is cleaned up (below), never from inside its try/finally.
                    retryFresh = true;
                } else if (error.code === "aborted") this.note("Stopped.");
                else this.fail(describeFailure(error));
            } else {
                logger.error("The chat turn failed", { error });
                this.fail(error instanceof Error ? error.message : "Something went wrong");
            }
        } finally {
            flushSpoken();
            this.log.write({ kind: "turn-end", turn: turn.id, ms: Date.now() - turnStartedAt });
            this.runtime.endTurn(token);
            this.current = undefined;
            await fs.rm(configPath, { force: true }).catch(() => undefined);
        }
        if (retryFresh) await this.runTurn(prompt, false);
    }
}

export const agentChat = new AgentChat();
