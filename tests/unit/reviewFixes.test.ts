import os from "node:os";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { dialogBridge } from "#base/bridges/dialogBridge";
import { AgentTurn } from "#base/agent/agentTurn";
import { TaskLocks } from "#base/task/taskLock";
import { StatusType } from "#base/task/task-status";
import { TaskOrchestrator } from "#base/task/orchestrator";
import { untilAborted } from "#utils/errors";
import { runAllowance } from "#flows/musicDownloadFlow/agent/runAllowance";
import { agentJournal } from "#flows/musicDownloadFlow/agent/taskAccess";
import { runSelected } from "#flows/musicDownloadFlow/runController";
import { DownloadTask } from "#flows/musicDownloadFlow/utils/downloadTask";
import { downloadSourceIds } from "#flows/musicDownloadFlow/utils/taskRevision";
import { installWorld, makeTrack, callTool, downloadedRow, meta } from "./helpers/agentWorld";

/**
 * Fixes that came out of reviewing the P32 diff (2026-11-15): each test pins the behaviour that replaced the bug.
 */

beforeAll(async () => {
    const { SettingsStore } = await import("#settings/settingsStore");
    SettingsStore.getInstance().patchMusicSettings({ musicBrainz: { matchTracks: false } });
});

afterEach(() => {
    dialogBridge.setConfirmOpener(null);
    runAllowance.reset();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe("a confirm dialog does not outlive the turn that asked it", () => {
    test("after Stop the dialog is taken off the screen, and a late answer changes nothing", async () => {
        const ready = makeTrack("ready1", "Ready", { metadataDiscovered: true });
        installWorld([ready]);
        const part = vi.spyOn(DownloadTask.prototype, "runDownloadPart").mockResolvedValue(undefined);
        let answer: (index: number | null) => void = () => undefined;
        const withdrawn = vi.fn();
        dialogBridge.setConfirmOpener((_dialog, resolve) => {
            answer = resolve;
            return withdrawn;
        });

        const turn = new AgentTurn();
        const call = callTool("run_download", { taskIds: ["ready1"] }, turn);
        await new Promise((r) => setTimeout(r, 10));

        turn.stop();
        // The UI was told to close the dialog.
        expect(withdrawn).toHaveBeenCalledTimes(1);
        // Even if a button reaches the app afterwards (a keypress already in flight), it is not read as consent.
        answer(2);
        const result = await call;

        expect(result.json).toMatchObject({ started: [], cancelled: true });
        expect(part).not.toHaveBeenCalled();
        expect(runAllowance.downloads).toBe(false);
    });

    test("a question still waiting in line when the signal aborts never reaches the screen", async () => {
        const shown: string[] = [];
        const answers: ((i: number | null) => void)[] = [];
        dialogBridge.setConfirmOpener((dialog, resolve) => {
            shown.push(dialog.title);
            answers.push(resolve);
        });
        const dialog = (title: string) => ({
            title,
            message: "",
            choices: [{ label: "OK", tone: "primary" as const }],
        });

        const first = dialogBridge.confirm(dialog("first"));
        const controller = new AbortController();
        const second = dialogBridge.confirm(dialog("second"), { signal: controller.signal });
        const third = dialogBridge.confirm(dialog("third"));

        controller.abort();
        expect(await second).toBeNull();

        answers[0](0);
        expect(await first).toBe(0);
        await new Promise((r) => setTimeout(r, 10));
        // The aborted one was skipped: the third is next.
        expect(shown).toEqual(["first", "third"]);
        answers[1](1);
        expect(await third).toBe(1);
    });

    test("a signal that is already aborted asks nothing", async () => {
        const opener = vi.fn();
        dialogBridge.setConfirmOpener(opener);
        const controller = new AbortController();
        controller.abort();
        const answer = await dialogBridge.confirm(
            { title: "t", message: "", choices: [{ label: "OK", tone: "primary" }] },
            { signal: controller.signal }
        );
        expect(answer).toBeNull();
        expect(opener).not.toHaveBeenCalled();
    });
});

describe("TaskLocks sweep", () => {
    test("a short lease taken after a long one is swept when it expires, and the row is told", () => {
        vi.useFakeTimers();
        const locks = new TaskLocks();
        let emits = 0;
        locks.subscribe(() => emits++);

        // Two leases never released (a hung call): a long one first, then a short one.
        locks.acquire(["long"], "agent", { ttlMs: 300_000 });
        locks.acquire(["short"], "agent", { ttlMs: 1_000 });
        emits = 0;

        vi.advanceTimersByTime(2_000);
        expect(locks.heldBy("short")).toBeUndefined();
        // The "Claude is working" marker of that row goes away now, not 5 minutes later.
        expect(emits).toBeGreaterThan(0);
        // The long one is still held.
        expect(locks.heldBy("long")).toBe("agent");

        emits = 0;
        vi.advanceTimersByTime(300_000);
        expect(emits).toBeGreaterThan(0);
        expect(locks.heldBy("long")).toBeUndefined();
    });

    test("a renewed lease is not dropped early by the timer that was set for its old expiry", () => {
        vi.useFakeTimers();
        const locks = new TaskLocks();
        const got = locks.acquire(["a"], "agent", { ttlMs: 1_000 });
        if (!got.ok) throw new Error("not acquired");
        vi.advanceTimersByTime(900);
        got.lease.renew(10_000);
        vi.advanceTimersByTime(5_000);
        expect(locks.heldBy("a")).toBe("agent");
        vi.advanceTimersByTime(6_000);
        expect(locks.heldBy("a")).toBeUndefined();
    });
});

describe("what Claude reads hides the user's name and folders", () => {
    test("the status of a task still running in wait_for_tasks", async () => {
        const running = makeTrack("mask1", "Song", { state: "running" });
        installWorld([running]);
        running.getStatus().set({ type: StatusType.Processing, message: `Reading ${os.homedir()}\\Music\\file.flac` });
        const turn = new AgentTurn();
        const pending = callTool("wait_for_tasks", { taskIds: ["mask1"], timeoutSec: 60 }, turn);
        setTimeout(() => turn.stop(), 100);
        const result = await pending;
        const status = result.json.tasks[0].status as string;
        expect(status).toContain("~");
        expect(status).not.toContain(os.homedir());
        expect(result.text).not.toContain(os.homedir());
    });

    test("the error of a platform result in get_task", async () => {
        const task = makeTrack("mask2", "Song");
        const group = task.getAttributes()!.metadataGroups[0];
        task.updateAttributes({
            metadataGroups: [
                {
                    ...group,
                    results: [
                        { ...group.results[0], fetchState: "error", fetchError: `Cannot open ${os.homedir()}\\cache` },
                    ],
                },
            ],
        });
        installWorld([task]);
        const result = await callTool("get_task", { taskId: "mask2" });
        expect(result.isError).toBe(false);
        expect(result.text).not.toContain(os.homedir());
        expect(result.text).toContain("Cannot open ~");
    });
});

describe("reject_source and undo", () => {
    const rowsOf = (task: DownloadTask) => task.getAttributes()!.downloadSources;

    test("rejecting a row that is downloading says it cannot be undone, and offers no undo", async () => {
        const task = makeTrack("rej1", "Song", {
            downloadSources: [
                {
                    ...downloadedRow("ytdlp", "a.flac", meta("rej1", "Song")),
                    state: "downloading",
                    localFile: undefined,
                },
            ],
        });
        installWorld([task]);
        const [sourceId] = downloadSourceIds(rowsOf(task));
        const result = await callTool("reject_source", { taskId: "rej1", sourceId, revision: task.getRevision() });
        expect(result.isError).toBe(false);
        expect(result.json.note).toMatch(/cannot be undone/);
        expect(rowsOf(task)[0].isRejected).toBe(true);
        expect(await agentJournal.undoLast()).toMatchObject({ done: false, reason: "nothing" });
    });

    test("rejecting a finished row can still be undone", async () => {
        const task = makeTrack("rej2", "Song", {
            downloadSources: [downloadedRow("ytdlp", "a.flac", meta("rej2", "Song"))],
        });
        installWorld([task]);
        const [sourceId] = downloadSourceIds(rowsOf(task));
        const result = await callTool("reject_source", { taskId: "rej2", sourceId, revision: task.getRevision() });
        expect(result.json.note).toBeUndefined();
        expect(rowsOf(task)[0].isRejected).toBe(true);
        expect(await agentJournal.undoLast()).toMatchObject({ done: true });
        expect(rowsOf(task)[0].isRejected).toBe(false);
    });
});

describe("Stop reaches the long tools", () => {
    test("untilAborted stops waiting at once, and leaves a promise that settles first alone", async () => {
        const never = new Promise<string>(() => undefined);
        const controller = new AbortController();
        const waiting = untilAborted(never, controller.signal);
        controller.abort();
        await expect(waiting).rejects.toMatchObject({ name: "AbortError" });

        await expect(untilAborted(Promise.resolve("ok"), new AbortController().signal)).resolves.toBe("ok");
        await expect(untilAborted(Promise.resolve("ok"), undefined)).resolves.toBe("ok");
        const done = new AbortController();
        done.abort();
        await expect(untilAborted(Promise.resolve("late"), done.signal)).rejects.toMatchObject({ name: "AbortError" });
    });

    test("search_music gives up when the turn is stopped", async () => {
        installWorld([]);
        const scratchSearch = vi
            .spyOn(DownloadTask.prototype, "searchCatalog")
            .mockReturnValue(new Promise(() => undefined));
        const turn = new AgentTurn();
        const call = callTool("search_music", { query: "anything at all" }, turn);
        await new Promise((r) => setTimeout(r, 10));
        expect(scratchSearch).toHaveBeenCalled();
        turn.stop();
        const result = await call;
        expect(result.isError).toBe(true);
    });

    test("rediscover hands the turn's signal to the search, so Stop ends it", async () => {
        const task = makeTrack("redo1", "Song");
        installWorld([task]);
        let release: () => void = () => undefined;
        const part = vi.spyOn(task, "rediscoverPart").mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    release = resolve;
                })
        );
        const turn = new AgentTurn();
        const call = callTool("rediscover", { taskId: "redo1", revision: task.getRevision() }, turn);
        await new Promise((r) => setTimeout(r, 10));
        const signal = part.mock.calls[0][1]?.signal;
        expect(signal).toBe(turn.signal);
        expect(signal?.aborted).toBe(false);
        turn.stop();
        expect(signal?.aborted).toBe(true);
        release();
        await call;
    });

    test("a whole-stage search ends early when its signal aborts (the real discovery, not a mock)", async () => {
        const task = makeTrack("redo2", "Song");
        installWorld([task]);
        const controller = new AbortController();
        let release: () => void = () => undefined;
        // The first thing the stage does is apply the user's links: one that never answers keeps the stage waiting.
        (task as unknown as { applyUserSources: () => Promise<void> }).applyUserSources = () =>
            new Promise<void>((resolve) => {
                release = resolve;
            });
        const run = task.startMetadataDiscovering({ skipLastResort: true, signal: controller.signal });
        await new Promise((r) => setTimeout(r, 10));
        controller.abort();
        await run;
        expect(task.getAttributes()?.metadataDiscoveringInProgress).toBe(false);
        release();
    });
});

describe("a Run that does nothing says why", () => {
    test("a batch is already going", async () => {
        const task = makeTrack("busy1", "Song", { state: "pending", primaryMetadataFetched: false });
        installWorld([task]);
        const orchestrator = TaskOrchestrator.getInstance();
        vi.spyOn(orchestrator, "isProcessing").mockReturnValue(true);
        const process = vi.spyOn(orchestrator, "processTasks").mockResolvedValue(undefined);
        expect(await runSelected(new Set(["busy1"]))).toMatch(/Another run/);
        expect(process).not.toHaveBeenCalled();
    });

    test("every task asked for is already running: nothing is processed and the user is told", async () => {
        const task = makeTrack("busy2", "Song", { state: "running" });
        installWorld([task]);
        const process = vi.spyOn(TaskOrchestrator.getInstance(), "processTasks").mockResolvedValue(undefined);
        expect(await runSelected(new Set(["busy2"]))).toMatch(/Already running/);
        expect(process).not.toHaveBeenCalled();
    });

    test("a task that can start starts, and there is nothing to explain", async () => {
        const task = makeTrack("free1", "Song", { state: "pending", primaryMetadataFetched: false });
        installWorld([task]);
        const process = vi.spyOn(TaskOrchestrator.getInstance(), "processTasks").mockResolvedValue(undefined);
        expect(await runSelected(new Set(["free1"]))).toBeUndefined();
        expect(process).toHaveBeenCalledTimes(1);
    });
});
