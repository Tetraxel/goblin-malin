import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { TaskOrchestrator } from "#base/task/orchestrator";
import { StatusType } from "#base/task/task-status";
import { notificationScheduler } from "#base/notificationScheduler";
import { runAll } from "#flows/musicDownloadFlow/runController";
import { reviveTaskDates } from "#flows/musicDownloadFlow/utils/reviveTaskDates";
import type { MusicDownloadTaskAttributes, TrackDownloadTask } from "#flows/musicDownloadFlow/types";
import { makeTrack } from "./helpers/agentWorld";

// `finishedAt` and the "running" flag are not saved with a session, the state is. What a run may start, and what may
// be deleted, has to follow the state too.

const orchestrator = TaskOrchestrator.getInstance();
const track = (id: string, state: TrackDownloadTask["state"]) => makeTrack(id, `Song ${id}`, { state });

beforeEach(() => {
    notificationScheduler.setSyncMode(true);
    orchestrator.setTasks([]);
});
afterEach(() => orchestrator.setTasks([]));

describe("which tasks a run takes (a reopened session has no finishedAt)", () => {
    test("only a pending or stopped track is a candidate", () => {
        orchestrator.setTasks([
            track("p", "pending"),
            track("s", "stopped"),
            track("f", "finished"),
            track("x", "failed"),
            track("r", "running"),
        ]);
        expect(orchestrator.getTasksCandidates().map((t) => t.getId())).toEqual(["p", "s"]);
    });

    test("'Run all' on a session of finished tracks leaves their status alone", async () => {
        const done = track("f", "finished");
        done.getStatus().set({ type: StatusType.Success, message: "Saved" });
        orchestrator.setTasks([done, track("x", "failed")]);

        await runAll();

        expect(done.getStatus().get().message).toBe("Saved");
        expect(orchestrator.isProcessing()).toBe(false);
    });

    test("a track that finishes in this session stays out of the next run", () => {
        const t = track("p", "pending");
        orchestrator.setTasks([t]);
        t.finishedAt = new Date();
        expect(orchestrator.getTasksCandidates()).toEqual([]);
    });
});

describe("a task that is busy", () => {
    test.each([
        ["the pump runs it", (t: ReturnType<typeof track>) => void (t.running = true)],
        ["it is in the state running", (t: ReturnType<typeof track>) => t.updateAttributes({ state: "running" })],
    ])("%s", (_name, make) => {
        const t = track("a", "pending");
        expect(t.isBusy()).toBe(false);
        make(t);
        expect(t.isBusy()).toBe(true);
    });

    test("an idle track is not busy, whatever its state", () => {
        for (const state of ["pending", "stopped", "finished", "failed"] as const) {
            expect(track("a", state).isBusy()).toBe(false);
        }
    });
});

describe("a saved 'running' state (the app was closed or killed during the run)", () => {
    const saved = (state: TrackDownloadTask["state"]) =>
        ({ kind: "track", state, userInput: { type: "url", url: "u" } }) as unknown as MusicDownloadTaskAttributes;

    test("comes back as stopped, so the task can be run, archived and deleted", () => {
        expect(reviveTaskDates(saved("running")).state).toBe("stopped");
    });

    test("any other state is kept", () => {
        for (const state of ["pending", "stopped", "finished", "failed"] as const) {
            expect(reviveTaskDates(saved(state)).state).toBe(state);
        }
    });
});

describe("Delete on a task that is running", () => {
    /** The delete the user confirms ("Delete", not "Archive") for these tasks, as the list builds it. */
    async function deleteForever(tasks: ReturnType<typeof track>[]): Promise<void> {
        const { buildContextualActionBar } = await import("#flows/musicDownloadFlow/contextualActions");
        const { deleteConfirmBridge } = await import("#base/bridges/deleteConfirmBridge");
        deleteConfirmBridge.setOpener((request) => request.apply());
        try {
            const bar = buildContextualActionBar(tasks[0], { columns: [], columnIndex: 0, selectedTasks: tasks });
            const action = bar.rows.flatMap((row) => row.actions).find((a) => a.label === "Archive / Delete")!;
            if (tasks.length > 1) action.onClickBatch!(tasks);
            else action.onClick();
        } finally {
            deleteConfirmBridge.setOpener(null);
        }
    }

    test("leaves it in the list (its work could not be stopped any more) and removes the idle ones", async () => {
        const busy = track("busy", "pending");
        busy.running = true;
        const idle = track("idle", "finished");
        orchestrator.setTasks([busy, idle]);

        await deleteForever([busy, idle]);

        expect(orchestrator.getTasks().map((t) => t.getId())).toEqual(["busy"]);
    });

    test("a track in the state 'running' is kept too", async () => {
        const started = track("started", "running");
        orchestrator.setTasks([started]);
        await deleteForever([started]);
        expect(orchestrator.getTasks()).toHaveLength(1);
    });

    test("an idle track is deleted as before", async () => {
        const idle = track("idle", "finished");
        orchestrator.setTasks([idle]);
        await deleteForever([idle]);
        expect(orchestrator.getTasks()).toHaveLength(0);
    });
});
