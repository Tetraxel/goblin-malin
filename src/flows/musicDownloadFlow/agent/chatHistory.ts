import fs from "node:fs/promises";
import path from "node:path";
import { globalLogger } from "#base/logger/logger";
import { getAppDataDir } from "#utils/appPaths";
import { type ChatMessage } from "./chatStore";

const logger = globalLogger.createChild({ service: "ChatHistory" });

/** The last conversation with Claude, kept so the user can reopen it. One conversation: the newest replaces it. */
export type SavedChat = {
    version: 1;
    savedAt: string;
    /** The Claude Code session the conversation was in: reopening resumes it, so Claude remembers it too. */
    sessionId: string;
    messages: ChatMessage[];
};

export const CHAT_HISTORY_FILE = "agent-chat.json";
/** The newest messages kept: a long conversation costs a lot to resume anyway. */
const MAX_SAVED_MESSAGES = 200;

const filePath = (): string => path.join(getAppDataDir(), CHAT_HISTORY_FILE);

const isMessage = (value: unknown): value is ChatMessage => {
    if (typeof value !== "object" || value === null) return false;
    const m = value as Record<string, unknown>;
    return typeof m.id === "number" && typeof m.text === "string" && typeof m.role === "string";
};

/** Writes the conversation. Never throws: failing to remember a chat must not break the chat. */
export async function saveChatHistory(chat: { sessionId: string; messages: readonly ChatMessage[] }): Promise<void> {
    if (!chat.messages.some((m) => m.role === "user")) return;
    const saved: SavedChat = {
        version: 1,
        savedAt: new Date().toISOString(),
        sessionId: chat.sessionId,
        messages: chat.messages.slice(-MAX_SAVED_MESSAGES).map((m) => ({ ...m, expanded: undefined })),
    };
    const target = filePath();
    const temp = `${target}.tmp`;
    try {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(temp, JSON.stringify(saved), "utf8");
        await fs.rename(temp, target);
    } catch (error) {
        logger.warn(`Could not save the conversation: ${(error as Error).message}`);
        await fs.rm(temp, { force: true }).catch(() => undefined);
    }
}

/** The saved conversation, or undefined when there is none (or the file is not one: it is left alone). */
export async function loadChatHistory(): Promise<SavedChat | undefined> {
    try {
        const raw = JSON.parse(await fs.readFile(filePath(), "utf8")) as Partial<SavedChat>;
        if (raw.version !== 1 || typeof raw.sessionId !== "string" || !Array.isArray(raw.messages)) return undefined;
        const messages = raw.messages.filter(isMessage);
        // The newest messages are what is kept, so the user's first one may be gone: any message will do.
        if (messages.length === 0) return undefined;
        return { version: 1, savedAt: String(raw.savedAt ?? ""), sessionId: raw.sessionId, messages };
    } catch {
        return undefined;
    }
}

/** What the "reopen" button says about the saved conversation, without its text. */
export type SavedChatSummary = { messages: number; savedAt: Date; firstUserMessage: string };

export function summarizeSavedChat(saved: SavedChat): SavedChatSummary {
    const first = saved.messages.find((m) => m.role === "user");
    const at = new Date(saved.savedAt);
    return {
        messages: saved.messages.filter((m) => m.role === "user").length || saved.messages.length,
        savedAt: Number.isNaN(at.getTime()) ? new Date(0) : at,
        firstUserMessage: first?.text.replace(/\s+/g, " ").slice(0, 80) ?? "",
    };
}
