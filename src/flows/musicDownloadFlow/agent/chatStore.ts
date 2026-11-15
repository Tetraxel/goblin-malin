/**
 * What the chat panel shows, held outside React so the conversation survives the panel being closed, and so a
 * streaming answer costs few repaints: Ink repaints the WHOLE screen on every React commit (and Windows repaints on
 * every commit), so the text Claude is writing is gathered and shown a few times a second, not once per word.
 */

export type ChatRole = "user" | "assistant" | "tool" | "note" | "error";

export type ChatMessage = {
    id: number;
    role: ChatRole;
    text: string;
    /** For a tool line: running, done or failed. */
    state?: "running" | "done" | "failed";
    /** For a tool line: the call as Claude sent it and what the tool answered, raw (cut when very long). */
    detail?: { input: string; output?: string };
    /** For a tool line: the details are shown under it. */
    expanded?: boolean;
};

/** The most of a call's input or answer that is kept: it is for the user to read, not to replay. */
const MAX_DETAIL_CHARS = 8000;

/** A tool's input or answer as raw text, cut when it is very long. */
export function rawText(value: unknown): string {
    let text: string;
    if (typeof value === "string") text = value;
    else {
        try {
            text = JSON.stringify(value ?? {}) ?? "";
        } catch {
            text = String(value);
        }
    }
    return text.length > MAX_DETAIL_CHARS
        ? `${text.slice(0, MAX_DETAIL_CHARS)}… (${text.length - MAX_DETAIL_CHARS} more characters)`
        : text;
}

export type ChatUsage = { messages: number; turns: number; costUsd: number };

export type ChatSnapshot = {
    messages: readonly ChatMessage[];
    busy: boolean;
    /** What Claude is doing right now ("Thinking…", "Applying 12 of 40"); empty when idle. */
    activity: string;
    /** This launch's use of the user's plan. */
    usage: ChatUsage;
};

/** How often streamed text reaches the screen at most. 100 ms would be ten full-screen repaints a second. */
export const STREAM_FLUSH_MS = 300;
const MAX_MESSAGES = 300;

export class ChatStore {
    private messages: ChatMessage[] = [];
    private busy = false;
    private activity = "";
    private usage: ChatUsage = { messages: 0, turns: 0, costUsd: 0 };
    private nextId = 1;
    private listeners = new Set<() => void>();
    private snapshot: ChatSnapshot;
    private toolMessages = new Map<string, number>();
    // "Expand all" was pressed: the tool calls that come next are shown open too.
    private expandNew = false;

    // Text of the answer being written that has not been shown yet.
    private pendingText = "";
    private openAssistantId: number | undefined;
    private flushTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(private readonly flushMs = STREAM_FLUSH_MS) {
        this.snapshot = this.build();
    }

    private build(): ChatSnapshot {
        return { messages: this.messages, busy: this.busy, activity: this.activity, usage: this.usage };
    }

    /** Stable between changes: safe for `useSyncExternalStore`. */
    getSnapshot = (): ChatSnapshot => this.snapshot;

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };

    private commit(): void {
        this.snapshot = this.build();
        this.listeners.forEach((l) => l());
    }

    private push(
        role: ChatRole,
        text: string,
        state?: ChatMessage["state"],
        extra: Partial<ChatMessage> = {}
    ): ChatMessage {
        const message: ChatMessage = { id: this.nextId++, role, text, ...(state ? { state } : {}), ...extra };
        this.messages = [...this.messages, message].slice(-MAX_MESSAGES);
        return message;
    }

    /** Shows the text gathered so far. Called by the timer, and before anything that must come after it. */
    flush(): void {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = undefined;
        }
        if (this.pendingText === "") return;
        const text = this.pendingText;
        this.pendingText = "";
        const open =
            this.openAssistantId !== undefined ? this.messages.find((m) => m.id === this.openAssistantId) : undefined;
        if (open) {
            this.messages = this.messages.map((m) => (m.id === open.id ? { ...m, text: m.text + text } : m));
        } else {
            this.openAssistantId = this.push("assistant", text).id;
        }
        this.commit();
    }

    /** A piece of the answer. Gathered and shown at most every {@link STREAM_FLUSH_MS}. */
    appendAssistant(delta: string): void {
        if (delta === "") return;
        this.pendingText += delta;
        if (!this.flushTimer) {
            this.flushTimer = setTimeout(() => this.flush(), this.flushMs);
            this.flushTimer.unref?.();
        }
    }

    addUser(text: string): void {
        this.flush();
        this.openAssistantId = undefined;
        this.push("user", text);
        this.usage = { ...this.usage, messages: this.usage.messages + 1 };
        this.commit();
    }

    /** A tool call, shown live ("select_source → Track X") until its result arrives. */
    addTool(toolUseId: string, label: string, input?: unknown): void {
        this.flush();
        this.openAssistantId = undefined;
        const message = this.push("tool", label, "running", {
            detail: { input: rawText(input) },
            ...(this.expandNew ? { expanded: true } : {}),
        });
        this.toolMessages.set(toolUseId, message.id);
        this.commit();
    }

    finishTool(toolUseId: string, isError: boolean, output?: unknown): void {
        this.flush();
        const id = this.toolMessages.get(toolUseId);
        this.toolMessages.delete(toolUseId);
        if (id === undefined) return;
        this.messages = this.messages.map((m) =>
            m.id === id
                ? {
                      ...m,
                      state: isError ? "failed" : "done",
                      ...(m.detail && output !== undefined ? { detail: { ...m.detail, output: rawText(output) } } : {}),
                  }
                : m
        );
        this.commit();
    }

    /** Shows or hides the raw call and answer under one tool line. */
    toggleTool(id: number): void {
        if (!this.messages.some((m) => m.id === id && m.detail)) return;
        this.messages = this.messages.map((m) => (m.id === id ? { ...m, expanded: !m.expanded } : m));
        this.commit();
    }

    /** Opens the details of every tool line, or closes them all when every one is open. The next calls follow. */
    toggleAllTools(): void {
        const withDetail = this.messages.filter((m) => m.role === "tool" && m.detail);
        // Open them all, unless they all are open already. With none yet it only decides how the next ones come.
        this.expandNew = withDetail.length === 0 ? !this.expandNew : !withDetail.every((m) => m.expanded);
        const open = this.expandNew;
        this.messages = this.messages.map((m) => (m.role === "tool" && m.detail ? { ...m, expanded: open } : m));
        this.commit();
    }

    /** Puts back a conversation that was saved (the details stay closed). */
    restore(messages: readonly ChatMessage[]): void {
        this.flush();
        this.messages = messages.map((m) => ({
            ...m,
            state: m.state === "running" ? "failed" : m.state,
            expanded: false,
        }));
        this.nextId = this.messages.reduce((max, m) => Math.max(max, m.id), 0) + 1;
        this.openAssistantId = undefined;
        this.toolMessages.clear();
        this.expandNew = false;
        this.commit();
    }

    addNote(text: string): void {
        this.flush();
        this.openAssistantId = undefined;
        this.push("note", text);
        this.commit();
    }

    addError(text: string): void {
        this.flush();
        this.openAssistantId = undefined;
        this.push("error", text);
        this.commit();
    }

    /** A whole answer that did not stream (an older CLI, or nothing arrived in pieces). */
    addAssistant(text: string): void {
        this.flush();
        this.openAssistantId = undefined;
        this.push("assistant", text);
        this.commit();
    }

    setBusy(busy: boolean): void {
        this.flush();
        if (this.busy === busy) return;
        this.busy = busy;
        if (!busy) {
            this.activity = "";
            this.openAssistantId = undefined;
            // A tool that never reported back (the turn was stopped) is not "running" any more.
            this.messages = this.messages.map((m) => (m.state === "running" ? { ...m, state: "failed" } : m));
            this.toolMessages.clear();
        }
        this.commit();
    }

    setActivity(activity: string): void {
        if (this.activity === activity) return;
        this.activity = activity;
        this.commit();
    }

    addUsage(costUsd: number | undefined, turns: number | undefined): void {
        this.usage = {
            ...this.usage,
            turns: this.usage.turns + (turns ?? 0),
            costUsd: this.usage.costUsd + (costUsd ?? 0),
        };
        this.commit();
    }

    /** A new conversation: the messages go; this launch's usage stays. */
    clear(): void {
        this.flush();
        this.messages = [];
        this.openAssistantId = undefined;
        this.toolMessages.clear();
        this.expandNew = false;
        this.commit();
    }
}

export const chatStore = new ChatStore();
