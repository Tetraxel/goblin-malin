import { describe, expect, test } from "vitest";
import os from "node:os";
import { BatchPlanStore, PLAN_TTL_MS, cleanTitle } from "#flows/musicDownloadFlow/agent/batchPlans";
import { TITLE_NOISE_PATTERN, filterTasks, maskPersonal } from "#flows/musicDownloadFlow/agent/views";
import { checkOverrideChange, validateMetadataOverride } from "#flows/musicDownloadFlow/utils/overrideValidation";
import { formatChatRows, formatMessage, maxScroll, visibleRows } from "#components/ChatPanel/formatChat";
import { isChatDocked, CHAT_DOCK_MIN_WIDTH, CHAT_PANEL_WIDTH } from "#components/ChatPanel/chatPanelState";
import { MIN_TERMINAL_WIDTH } from "#utils/terminalSize";
import { makeTrack } from "./helpers/agentWorld";

describe("cleanTitle", () => {
    test("removes video-site noise, however many tags there are", () => {
        expect(cleanTitle("Song (Official Video)", { removeNoise: true })).toBe("Song");
        expect(cleanTitle("Song [Lyrics] (HD) (Official Music Video)", { removeNoise: true })).toBe("Song");
        expect(cleanTitle("Artist - Song (Audio)", { removeNoise: true })).toBe("Artist - Song");
        expect(cleanTitle("Song (Live at Wembley)", { removeNoise: true })).toBe("Song (Live at Wembley)");
        expect(cleanTitle("Song (feat. Someone)", { removeNoise: true })).toBe("Song (feat. Someone)");
    });

    test("removes literal text, ignoring case, and never reads it as a pattern", () => {
        expect(cleanTitle("Song (2011 REMASTER)", { remove: ["(2011 remaster)"] })).toBe("Song");
        // A regular-expression bomb is just text here.
        expect(cleanTitle("aaaaaaaaaaaaaaaaaaaaaaaa!", { remove: ["(a+)+$"] })).toBe("aaaaaaaaaaaaaaaaaaaaaaaa!");
        expect(cleanTitle("Song .*", { remove: [".*"] })).toBe("Song");
    });

    test("tidies what is left", () => {
        expect(cleanTitle("  Song  -  (Official Video)  ", { removeNoise: true })).toBe("Song");
        expect(cleanTitle("Song | [Lyrics]", { removeNoise: true })).toBe("Song");
        expect(cleanTitle("(Official Video)", { removeNoise: true })).toBe("");
        expect(cleanTitle("Song", {})).toBe("Song");
    });

    test("a bracket that is part of the real title is not noise", () => {
        for (const title of [
            "Song (Full Circle)",
            "Song (Audio Bullys Remix)",
            "Song (Video Killed the Radio Star)",
            "Song (Lyrics Don't Lie)",
        ]) {
            expect(TITLE_NOISE_PATTERN.test(title)).toBe(false);
            expect(cleanTitle(title, { removeNoise: true })).toBe(title);
        }
        expect(cleanTitle("Song (Full Song) [HD]", { removeNoise: true })).toBe("Song");
    });

    test("the noise pattern is what the title_noise problem finds", () => {
        expect(TITLE_NOISE_PATTERN.test("Song (Official Video)")).toBe(true);
        expect(TITLE_NOISE_PATTERN.test("Song")).toBe(false);
        const tasks = [makeTrack("a", "Song (HD)"), makeTrack("b", "Song")];
        expect(filterTasks(tasks as never, { problem: "title_noise" }).map((t) => t.getId())).toEqual(["a"]);
    });
});

describe("metadata override validation", () => {
    test("accepts what the panel types and tidies it", () => {
        const check = validateMetadataOverride({
            trackName: "  Song  ",
            artists: ["A", { type: "artist", name: " B " }],
            isrc: "fr-t09 2400049",
            year: 2020,
            genres: ["house"],
            duration: 200_000,
        });
        expect(check).toEqual({
            ok: true,
            value: {
                trackName: "Song",
                artists: [
                    { type: "artist", name: "A" },
                    { type: "artist", name: "B" },
                ],
                isrc: "FRT092400049",
                year: 2020,
                genres: ["house"],
                duration: 200_000,
            },
        });
    });

    test.each([
        [{ trackName: "" }, /cannot be empty/],
        [{ trackName: "x".repeat(301) }, /too long/],
        [{ trackName: "bad\u0007title" }, /control character/],
        [{ artists: [] }, /1 to 30 names/],
        [{ artists: [""] }, /cannot be empty/],
        [{ year: 99 }, /between 1000 and 2200/],
        [{ year: 2000.5 }, /whole number/],
        [{ bpm: 0 }, /between 1 and 400/],
        [{ trackNumber: -1 }, /between 1 and 999/],
        [{ duration: 5 }, /between 1000/],
        [{ isrc: "short" }, /12 characters/],
        [{ genres: "house" }, /list of 1 to 30/],
        [{ album: { name: "x" } }, /not a valid album/],
        [{ title: "x" }, /not a field that can be overridden/],
    ])("refuses %j", (input, message) => {
        const check = validateMetadataOverride(input);
        expect(check.ok).toBe(false);
        if (!check.ok) expect(check.error).toMatch(message);
    });

    test("only what changes is checked", () => {
        const stored = { isrc: "legacy" } as never;
        expect(checkOverrideChange(stored, { isrc: "legacy", year: 2000 })).toEqual({
            ok: true,
            value: { isrc: "legacy", year: 2000 },
        });
        expect(checkOverrideChange(stored, { isrc: "alsobad" }).ok).toBe(false);
    });
});

describe("batch plans", () => {
    test("a plan is kept for a while, then it is gone", () => {
        let now = 0;
        const store = new BatchPlanStore(() => now);
        const plan = store.create("fix", []);
        expect(store.get(plan.id)).toBe(plan);
        now = PLAN_TTL_MS + 1;
        expect(store.get(plan.id)).toBeUndefined();
    });

    test("only the newest few are kept", () => {
        const store = new BatchPlanStore();
        const ids = Array.from({ length: 8 }, () => store.create("x", []).id);
        expect(store.get(ids[0])).toBeUndefined();
        expect(store.get(ids[7])).toBeDefined();
    });
});

describe("what leaves the app for Claude", () => {
    test("the user's name and home folder are hidden", () => {
        const home = os.homedir();
        expect(maskPersonal(`Saved to ${home}\\Music\\x.flac`)).toBe("Saved to ~\\Music\\x.flac");
        expect(maskPersonal(`${home.replace(/\\/g, "/")}/Music`)).toBe("~/Music");
        const user = os.userInfo().username;
        if (user.length >= 3) expect(maskPersonal(`logged in as ${user}.`)).toBe("logged in as <user>.");
    });
});

describe("the chat's rows", () => {
    const m = (
        id: number,
        role: "user" | "assistant" | "tool" | "note" | "error",
        text: string,
        state?: "running" | "done" | "failed"
    ) => ({
        id,
        role,
        text,
        state,
    });

    test("a message wraps to the width, with its marker on the first line only", () => {
        const rows = formatMessage(m(1, "user", "one two three four five six"), 12);
        // A message of the user sits between a blank row above and one below (they carry its background).
        expect(rows.map((r) => r.text)).toEqual(["", "one two", "three four", "five six", ""]);
        expect(rows.map((r) => r.marker)).toEqual(["", "›", "", "", ""]);
        expect(rows.every((r) => r.text.length <= 10)).toBe(true);
    });

    test("a word longer than a line is cut, and a newline starts a line", () => {
        expect(formatMessage(m(1, "assistant", "x".repeat(25)), 12).map((r) => r.text.length)).toEqual([10, 10, 5]);
        expect(formatMessage(m(2, "assistant", "a\nb"), 12).map((r) => r.text)).toEqual(["a", "b"]);
    });

    test("messages are set apart, but tool lines stay together", () => {
        const rows = formatChatRows(
            [
                m(1, "user", "hi"),
                m(2, "assistant", "ok"),
                m(3, "tool", "get_task a", "done"),
                m(4, "tool", "select_source a", "running"),
            ],
            40
        );
        expect(rows.map((r) => r.text)).toEqual(["", "hi", "", "", "ok", "", "get_task a", "select_source a"]);
    });

    test("the view shows the last rows, or the ones further back", () => {
        const rows = formatChatRows(
            [m(1, "assistant", Array.from({ length: 10 }, (_, i) => `line${i}`).join("\n"))],
            40
        );
        expect(visibleRows(rows, 3, 0).map((r) => r.text)).toEqual(["line7", "line8", "line9"]);
        expect(visibleRows(rows, 3, 2).map((r) => r.text)).toEqual(["line5", "line6", "line7"]);
        expect(maxScroll(rows.length, 3)).toBe(7);
        expect(visibleRows(rows, 20, 0)).toHaveLength(10);
    });

    test("the panel sits beside the list only where both fit", () => {
        expect(CHAT_DOCK_MIN_WIDTH).toBe(MIN_TERMINAL_WIDTH + CHAT_PANEL_WIDTH);
        expect(isChatDocked(CHAT_DOCK_MIN_WIDTH)).toBe(true);
        expect(isChatDocked(CHAT_DOCK_MIN_WIDTH - 1)).toBe(false);
    });
});
