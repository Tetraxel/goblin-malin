import { afterEach, describe, expect, test, vi } from "vitest";
import { createTasksFromSnapshots } from "#flows/musicDownloadFlow/taskFactory";
import { reviveTaskDates } from "#flows/musicDownloadFlow/utils/reviveTaskDates";
import { runSelected } from "#flows/musicDownloadFlow/runController";
import { TaskOrchestrator } from "#base/task/orchestrator";
import { notificationScheduler } from "#base/notificationScheduler";
import { type TrackDownloadSource, type TrackDownloadTask } from "#flows/musicDownloadFlow/types";
import { taskLocks } from "#base/task/taskLock";
import { type DownloadTask } from "#flows/musicDownloadFlow/utils/downloadTask";
import { downloadedRow, makeTrack, meta } from "./helpers/agentWorld";

// A session saved while two runs wrote to the same track had `null` where a download row should be (a write at a
// position the other run had just emptied). The app crashed on it, in the Download view and at start-up.

const dated = (row: TrackDownloadSource) => ({ ...row, downloadedAt: row.downloadedAt.toISOString() });

describe("a saved track with holes in its download rows", () => {
    const row = downloadedRow("soulseek", "a.flac", meta("t", "Song"));

    test("loads, without the holes", () => {
        const loaded = reviveTaskDates({
            ...(makeTrack("t", "Song").getAttributes() as TrackDownloadTask),
            downloadSources: [null, dated(row), null] as never,
            metadataGroups: [
                {
                    platform: "spotify",
                    serviceKey: "spotify",
                    rank: 0,
                    results: [null, ...makeTrack("t", "Song").getAttributes()!.metadataGroups[0].results] as never,
                },
                null as never,
            ],
        }) as TrackDownloadTask;
        expect(loaded.downloadSources).toHaveLength(1);
        expect(loaded.downloadSources[0].provider).toBe("soulseek");
        expect(loaded.downloadSources[0].downloadedAt).toBeInstanceOf(Date);
        expect(loaded.metadataGroups).toHaveLength(1);
        expect(loaded.metadataGroups[0].results.every((r) => r !== null)).toBe(true);
    });

    test("a whole session snapshot with such a track becomes tasks again", () => {
        const attributes = {
            ...(makeTrack("t2", "Song").getAttributes() as TrackDownloadTask),
            state: "failed",
            downloadSources: [null, dated(row)],
        };
        const [task] = createTasksFromSnapshots([
            { id: "t2", initialInput: "https://example.test/t2", attributes, status: undefined } as never,
        ]);
        expect(task.getId()).toBe("t2");
        expect((task.getAttributes() as TrackDownloadTask).downloadSources).toHaveLength(1);
    });
});

describe("running a track that is already running", () => {
    test("leaves it alone: its download rows are not emptied under the run that writes to them", async () => {
        notificationScheduler.setSyncMode(true);
        const rows = [downloadedRow("ytdlp", "a.flac", meta("r", "Song"))];
        const running = makeTrack("r", "Song", { state: "running", downloadSources: rows });
        TaskOrchestrator.getInstance().setTasks([running]);
        await runSelected(new Set(["r"]));
        const after = running.getAttributes() as TrackDownloadTask;
        expect(after.state).toBe("running");
        expect(after.downloadSources).toHaveLength(1);
    });
});

describe("runSelected", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        taskLocks.clear();
    });

    test("does not change the set it is given (it is the list's live selection)", async () => {
        notificationScheduler.setSyncMode(true);
        const running = makeTrack("busy", "Song", { state: "running" });
        const held = makeTrack("held", "Song", { state: "failed" });
        TaskOrchestrator.getInstance().setTasks([running, held]);
        taskLocks.acquire(["held"], "agent");
        const selection = new Set(["busy", "held", "gone"]);
        await runSelected(selection);
        expect([...selection]).toEqual(["busy", "held", "gone"]);
    });

    test("while a batch is already going, resets nothing and queues nothing", async () => {
        notificationScheduler.setSyncMode(true);
        const rows = [downloadedRow("ytdlp", "a.flac", meta("f", "Song"))];
        const failed = makeTrack("f", "Song", { state: "failed", downloadSources: rows });
        TaskOrchestrator.getInstance().setTasks([failed]);
        vi.spyOn(TaskOrchestrator.prototype, "isProcessing").mockReturnValue(true);
        const process = vi.spyOn(TaskOrchestrator.prototype, "processTasks").mockResolvedValue(undefined);
        await runSelected(new Set(["f"]));
        const after = failed.getAttributes() as TrackDownloadTask;
        expect(after.state).toBe("failed");
        expect(after.downloadSources).toHaveLength(1);
        expect(failed.getStatus().get().message).not.toBe("Queued");
        expect(process).not.toHaveBeenCalled();
    });
});

describe("one download run per track", () => {
    test("a second startDownloads on the same track is refused (not silently dropped) while the first goes on", async () => {
        const task = makeTrack("dl", "Song") as DownloadTask;
        let release!: () => void;
        const gate = new Promise<void>((resolve) => (release = resolve));
        const run = vi
            .spyOn(task as unknown as { runDownloads: () => Promise<void> }, "runDownloads")
            .mockImplementation(() => gate);
        const first = task.startDownloads();
        // A caller must not take "nothing happened" for "the downloads ran".
        await expect(task.startDownloads()).rejects.toThrow(/already going/);
        expect(run).toHaveBeenCalledTimes(1);
        release();
        await first;
        // Once the first is over, the track can be run again.
        await task.startDownloads();
        expect(run).toHaveBeenCalledTimes(2);
    });

    test("a run that was stopped and is still unwinding is waited for, not mistaken for a running one", async () => {
        const task = makeTrack("dl2", "Song") as DownloadTask;
        let release!: () => void;
        const gate = new Promise<void>((resolve) => (release = resolve));
        const run = vi
            .spyOn(task as unknown as { runDownloads: () => Promise<void> }, "runDownloads")
            .mockImplementationOnce(() => gate)
            .mockImplementation(() => Promise.resolve());
        const stop = new AbortController();
        const first = task.startDownloads(stop.signal);
        stop.abort();
        // The restart arrives while the aborted run's processes are still ending.
        const second = task.startDownloads(new AbortController().signal);
        await Promise.resolve();
        expect(run).toHaveBeenCalledTimes(1);
        release();
        await first;
        await second;
        expect(run).toHaveBeenCalledTimes(2);
    });
});
