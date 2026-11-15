import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { dialogBridge } from "#base/bridges/dialogBridge";
import { SettingsStore } from "#settings/settingsStore";
import { getAppDataDir } from "#utils/appPaths";
import {
    CHAT_HISTORY_FILE,
    loadChatHistory,
    saveChatHistory,
    summarizeSavedChat,
} from "#flows/musicDownloadFlow/agent/chatHistory";
import { chooseAgentModel } from "#flows/musicDownloadFlow/agent/chooseAgentModel";
import { getAgentSettings } from "#flows/musicDownloadFlow/agent/agentSettings";
import { timeAgo } from "#components/ChatPanel/timeAgo";

const file = () => path.join(getAppDataDir(), CHAT_HISTORY_FILE);
const message = (id: number, role: "user" | "assistant" | "tool", text: string) => ({ id, role, text });

beforeEach(() => fs.rmSync(file(), { force: true }));
afterEach(() => {
    fs.rmSync(file(), { force: true });
    dialogBridge.setListOpener(null);
});

describe("the saved conversation", () => {
    test("is written after a conversation and read back, with the details closed", async () => {
        await saveChatHistory({
            sessionId: "s1",
            messages: [
                message(1, "user", "hello"),
                { ...message(2, "tool", "get_task a"), detail: { input: "{}", output: "{}" }, expanded: true },
                message(3, "assistant", "hi"),
            ],
        });
        const saved = await loadChatHistory();
        expect(saved?.sessionId).toBe("s1");
        expect(saved?.messages.map((m) => m.text)).toEqual(["hello", "get_task a", "hi"]);
        expect(saved?.messages[1].detail).toEqual({ input: "{}", output: "{}" });
        expect(saved?.messages[1].expanded).toBeUndefined();
        expect(summarizeSavedChat(saved!)).toMatchObject({ messages: 1, firstUserMessage: "hello" });
    });

    test("nothing is written for a chat where the user said nothing, and the newest messages are what is kept", async () => {
        await saveChatHistory({ sessionId: "s", messages: [message(1, "assistant", "hi")] });
        expect(fs.existsSync(file())).toBe(false);
        const many = [
            message(0, "user", "first"),
            ...Array.from({ length: 300 }, (_, i) => message(i + 1, "assistant", `a${i}`)),
        ];
        await saveChatHistory({ sessionId: "s", messages: many });
        const saved = await loadChatHistory();
        expect(saved?.messages).toHaveLength(200);
        expect(saved?.messages.at(-1)?.text).toBe("a299");
    });

    test("a file that is not a saved conversation is ignored, never an error", async () => {
        expect(await loadChatHistory()).toBeUndefined();
        fs.mkdirSync(path.dirname(file()), { recursive: true });
        fs.writeFileSync(file(), "{ not json");
        expect(await loadChatHistory()).toBeUndefined();
        fs.writeFileSync(file(), JSON.stringify({ version: 1, sessionId: "s", messages: [{ nope: true }] }));
        expect(await loadChatHistory()).toBeUndefined();
    });
});

describe("choosing the model", () => {
    const seenStart: (number | undefined)[] = [];
    const answerWith = (index: number | null) =>
        dialogBridge.setListOpener((dialog, resolve) => {
            expect(dialog.items.map((i) => i.label.split(" ")[0])).toEqual(["haiku", "sonnet", "opus"]);
            // The cursor starts on the model in use.
            seenStart.push(dialog.initialIndex);
            resolve(index === null ? null : { index });
        });

    test("saves the model the user picks in Settings", async () => {
        SettingsStore.getInstance().patchMusicSettings({ agent: { model: "sonnet" } });
        answerWith(2);
        expect(await chooseAgentModel("#fff")).toBe("opus");
        expect(getAgentSettings().model).toBe("opus");
        expect(seenStart).toEqual([1]);
        SettingsStore.getInstance().patchMusicSettings({ agent: { model: "sonnet" } });
    });

    test("changes nothing when the dialog is dismissed or nobody is there to answer", async () => {
        SettingsStore.getInstance().patchMusicSettings({ agent: { model: "haiku" } });
        answerWith(null);
        expect(await chooseAgentModel("#fff")).toBeUndefined();
        dialogBridge.setListOpener(null);
        expect(await chooseAgentModel("#fff")).toBeUndefined();
        expect(getAgentSettings().model).toBe("haiku");
        SettingsStore.getInstance().patchMusicSettings({ agent: { model: "sonnet" } });
    });
});

describe("timeAgo", () => {
    test("says roughly how long ago", () => {
        const now = Date.UTC(2026, 10, 15, 12, 0, 0);
        const ago = (ms: number) => timeAgo(new Date(now - ms), now);
        expect(ago(10_000)).toBe("just now");
        expect(ago(5 * 60_000)).toBe("5 min ago");
        expect(ago(3 * 3_600_000)).toBe("3 h ago");
        expect(ago(24 * 3_600_000)).toBe("1 day ago");
        expect(ago(50 * 3_600_000)).toBe("2 days ago");
        expect(ago(-5000)).toBe("just now");
    });
});
