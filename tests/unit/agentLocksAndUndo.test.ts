import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { dialogBridge } from "#base/bridges/dialogBridge";
import { AgentTurn } from "#base/agent/agentTurn";
import { TaskOrchestrator } from "#base/task/orchestrator";
import { urlParserRegistry } from "#base/urlParser";
import { runSelected } from "#flows/musicDownloadFlow/runController";
import { agentJournal, isTaskRunning } from "#flows/musicDownloadFlow/agent/taskAccess";
import { runAllowance } from "#flows/musicDownloadFlow/agent/runAllowance";
import { chatStore } from "#flows/musicDownloadFlow/agent/chatStore";
import { DownloadTask } from "#flows/musicDownloadFlow/utils/downloadTask";
import { installWorld, makeTrack, callTool } from "./helpers/agentWorld";

/**
 * Who may change a track while Claude works on it, and what /undo does then: the lease covers the real task whatever
 * way its id was written, a part run again on a finished track counts as running, and an undo never puts back half of
 * an entry or erases what the user typed.
 */

// Starting a run would really process the track (network): the controller is replaced by a recorder, except where
// a test asks for the real one.
vi.mock("#flows/musicDownloadFlow/runController", () => ({
    runSelected: vi.fn(async () => undefined),
    runAll: vi.fn(),
    stopAll: vi.fn(),
}));

beforeAll(async () => {
    const { SettingsStore } = await import("#settings/settingsStore");
    SettingsStore.getInstance().patchMusicSettings({ musicBrainz: { matchTracks: false } });
    urlParserRegistry.register((url) =>
        url.startsWith("https://open.spotify.com/track/")
            ? { platform: "spotify", type: "track", id: url.split("/").pop() }
            : null
    );
});

afterEach(() => {
    dialogBridge.setConfirmOpener(null);
    vi.restoreAllMocks();
});

/** A promise and the function that settles it, for work a test holds open. */
function held(): { promise: Promise<void>; finish: () => void } {
    let finish!: () => void;
    const promise = new Promise<void>((resolve) => (finish = resolve));
    return { promise, finish };
}

const lastNote = () => chatStore.getSnapshot().messages.at(-1)?.text ?? "";

describe("the lease of a tool", () => {
    test('covers the real task when the model wrote its id without "task:"', async () => {
        const t = makeTrack("task:3d6da40a5c5c", "Song");
        installWorld([t]);
        const work = held();
        const discover = vi.spyOn(t, "startMetadataDiscovering").mockReturnValue(work.promise);

        const call = callTool("rediscover", { taskId: "3d6da40a5c5c", revision: t.getRevision() });
        await vi.waitFor(() => expect(discover).toHaveBeenCalled());
        // While Claude works on it, the user is kept out of the task (and its row shows it).
        expect(t.isLockedFor("user")).toBe(true);
        expect(() => t.setMetadataOverride({ trackName: "Typed" })).toThrow(/Claude is working/);

        work.finish();
        expect((await call).isError).toBe(false);
        expect(t.isLockedFor("user")).toBe(false);
    });
});

describe("a part run again on a finished track", () => {
    test("counts as running: Claude's writes are refused until it ends", async () => {
        const t = makeTrack("task:part1", "Song");
        installWorld([t]);
        const work = held();
        vi.spyOn(t, "startMetadataDiscovering").mockReturnValue(work.promise);

        expect((await callTool("run_metadata", { taskIds: ["task:part1"] })).isError).toBe(false);
        await vi.waitFor(() => expect(t.partRunning).toBe(true));
        expect(isTaskRunning(t)).toBe(true);
        const write = await callTool("set_metadata_override", {
            taskId: "task:part1",
            revision: t.getRevision(),
            patch: { trackName: "Fixed" },
        });
        expect(write.isError).toBe(true);
        expect(write.text).toMatch(/being processed/);

        work.finish();
        await vi.waitFor(() => expect(t.partRunning).toBe(false));
        expect(isTaskRunning(t)).toBe(false);
    });

    test("is not reset by the user starting the track meanwhile", async () => {
        const { runSelected: realRunSelected } = await vi.importActual<
            typeof import("#flows/musicDownloadFlow/runController")
        >("#flows/musicDownloadFlow/runController");
        const t = makeTrack("task:part2", "Song", { metadataOverride: { trackName: "Typed by the user" } });
        installWorld([t]);
        const work = held();
        vi.spyOn(t, "startMetadataDiscovering").mockReturnValue(work.promise);
        const process = vi.spyOn(TaskOrchestrator.getInstance(), "processTasks").mockResolvedValue(undefined);

        const part = t.runMetadataPart();
        await vi.waitFor(() => expect(t.partRunning).toBe(true));
        await realRunSelected(new Set(["task:part2"]));
        // Left as it is: not reset to "pending", and what the user typed is still there.
        expect(t.getAttributes()).toMatchObject({
            state: "finished",
            metadataOverride: { trackName: "Typed by the user" },
        });
        expect(t.getAttributes()?.metadataGroups).toHaveLength(1);
        expect([...(process.mock.calls[0]?.[0] ?? [])]).toEqual([]);

        work.finish();
        await part;
    });
});

describe("/undo", () => {
    test("waits while Claude still holds the task, then undoes the change whole", async () => {
        const t = makeTrack("task:und1", "Song");
        installWorld([t]);
        const turn = new AgentTurn();
        const set = await callTool(
            "set_metadata_override",
            { taskId: "task:und1", revision: t.getRevision(), patch: { trackName: "Fixed" } },
            turn
        );
        expect(set.isError).toBe(false);

        // A later call of the same turn holds the task (rediscover, apply_batch…) when the user presses Ctrl+Z.
        const lease = turn.acquire(["task:und1"]);
        const { AgentChat } = await import("#flows/musicDownloadFlow/agent/agentChat");
        const chat = new AgentChat({ log: { write: () => undefined } as never });
        await expect(chat.undo()).resolves.toBeUndefined();
        expect(lastNote()).toMatch(/Cannot undo .* yet/);
        expect(t.getAttributes()?.metadataOverride.trackName).toBe("Fixed");
        expect(agentJournal.list()).toHaveLength(1);

        if ("lease" in lease) lease.lease.release();
        await chat.undo();
        expect(lastNote()).toMatch(/^Undone/);
        expect(t.getAttributes()?.metadataOverride.trackName).toBeUndefined();
    });

    test("of add_tasks keeps a new track the user has edited since", async () => {
        installWorld([]);
        const link = (id: string) => `https://open.spotify.com/track/${id}`;
        const added = await callTool("add_tasks", { urls: [link("keep1"), link("drop1")] });
        expect(added.json.added).toHaveLength(2);
        const tasks = TaskOrchestrator.getInstance().getTasks();
        const kept = tasks.find((x) => x.getId() === added.json.added[0].taskId) as unknown as DownloadTask;
        kept.setMetadataOverride({ trackName: "Typed by the user" });

        expect((await agentJournal.undoLast()).done).toBe(true);
        expect(
            TaskOrchestrator.getInstance()
                .getTasks()
                .map((x) => x.getId())
        ).toEqual([kept.getId()]);
    });
});

describe("a question left open by a message that has ended", () => {
    test("is not joined by the same call in the next message: it asks again", async () => {
        const t = makeTrack("task:ready9", "Ready", { metadataDiscovered: true });
        installWorld([t]);
        runAllowance.reset();
        const part = vi.spyOn(DownloadTask.prototype, "runDownloadPart").mockResolvedValue(undefined);
        const answers: ((index: number | null) => void)[] = [];
        dialogBridge.setConfirmOpener((_dialog, resolve) => {
            answers.push(resolve);
        });

        const first = new AgentTurn();
        const old = callTool("run_download", { taskIds: ["task:ready9"] }, first);
        await vi.waitFor(() => expect(answers).toHaveLength(1));
        first.end();

        const next = callTool("run_download", { taskIds: ["task:ready9"] }, new AgentTurn());
        // Dialogs are shown one at a time: the late answer to the old question comes first, and starts nothing.
        answers[0](1);
        expect((await old).json.cancelled).toBe(true);

        // The next message asks its own question (joining the old call would have answered "nothing was started").
        await vi.waitFor(() => expect(answers).toHaveLength(2));
        answers[1](1);
        expect((await next).json.started).toEqual([{ taskId: "task:ready9" }]);
        expect(part).toHaveBeenCalledTimes(1);
        expect(runSelected).not.toHaveBeenCalled();
    });
});
