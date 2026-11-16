import { afterEach, describe, expect, test, vi } from "vitest";
import { dialogBridge, type ConfirmDialog } from "#base/bridges/dialogBridge";
import {
    confirmRestartCollection,
    confirmRestartTracks,
    restartLosesWork,
} from "#flows/musicDownloadFlow/utils/confirmReset";
import { makeTrack } from "./helpers/agentWorld";

// "R" on a finished track used to rebuild it at once, and on an album or playlist it removed every track.

const track = (state: string) => makeTrack(`t-${state}`, "Song", { state } as never);

/** Answers every dialog with the button at `index` (null: dismissed), and remembers what was asked. */
function answer(index: number | null) {
    const asked: ConfirmDialog[] = [];
    vi.spyOn(dialogBridge, "confirm").mockImplementation(async (dialog) => {
        asked.push(dialog);
        return index;
    });
    return asked;
}

afterEach(() => vi.restoreAllMocks());

describe("restarting tracks", () => {
    test("a track that was never run, or that failed, is restarted without a question", async () => {
        const asked = answer(0);
        expect(restartLosesWork(track("pending"))).toBe(false);
        expect(restartLosesWork(track("failed"))).toBe(false);
        expect(await confirmRestartTracks([track("pending"), track("failed")])).toBe(true);
        expect(asked).toHaveLength(0);
    });

    test("a finished track asks first, with the safe button first", async () => {
        const asked = answer(1);
        expect(await confirmRestartTracks([track("finished")])).toBe(true);
        expect(asked).toHaveLength(1);
        expect(asked[0].choices.map((c) => c.label)).toEqual(["Cancel", "Restart"]);
        expect(asked[0].message).toMatch(/kept/);
    });

    test("Cancel, Esc and 'nobody to ask' all mean no", async () => {
        for (const reply of [0, null]) {
            vi.restoreAllMocks();
            answer(reply);
            expect(await confirmRestartTracks([track("finished")])).toBe(false);
        }
    });

    test("several tracks make one question, saying how many", async () => {
        const asked = answer(1);
        await confirmRestartTracks([track("finished"), track("running"), track("pending")]);
        expect(asked).toHaveLength(1);
        expect(asked[0].title).toBe("Restart 2 tracks?");
    });
});

describe("restarting an album or playlist", () => {
    const collection = { getAttributes: () => ({ childTaskIds: ["a", "b", "c"] }) } as never;

    test.each([
        [0, null],
        [1, "archive"],
        [2, "delete"],
        [null, null],
    ])("button %j gives %j", async (button, expected) => {
        const asked = answer(button as number | null);
        expect(await confirmRestartCollection(collection)).toBe(expected);
        expect(asked[0].choices[0].label).toBe("Cancel");
        expect(asked[0].message).toContain("3 tracks");
    });
});
