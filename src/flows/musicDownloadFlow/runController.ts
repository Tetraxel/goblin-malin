import { TaskOrchestrator } from "#base/task/orchestrator";
import { StatusType } from "#base/task/task-status";
import { taskLocks, type LockHolder } from "#base/task/taskLock";
import { globalLogger } from "#base/logger/logger";
import { dialogBridge } from "#base/bridges/dialogBridge";
import { type DownloadTask } from "./utils/downloadTask";
import { type CollectionTask } from "./utils/collectionTask";

/** Whether one of the task's parts (re-fetch, re-discover, download) is running: it leaves `state` alone. */
const isPartRunning = (task: object): boolean => Boolean((task as { partRunning?: boolean }).partRunning);

/**
 * Queue every candidate task and start processing.
 *
 * A task Claude holds, or one of whose parts is running, is left out, as {@link runSelected} does: starting it would
 * rebuild the groups under whoever is writing to them. It stays pending for the next run.
 */
export async function runAll(): Promise<void> {
    const orchestrator = TaskOrchestrator.getInstance();
    // Set only when something was left out: the orchestrator then processes just these (without a filter it takes
    // every pending task, the locked ones included).
    let only: Set<string> | undefined;
    if (!orchestrator.isProcessing()) {
        const candidates = orchestrator.getTasksCandidates();
        const startable = candidates.filter((task) => {
            if (taskLocks.isLocked(task.getId(), "user") || isPartRunning(task)) {
                globalLogger.info(`Not started: ${task.getId()} is being worked on`);
                return false;
            }
            return true;
        });
        for (const task of startable) task.getStatus().set({ type: StatusType.Pending, message: "Queued" });
        if (startable.length < candidates.length) {
            if (startable.length === 0) return;
            only = new Set(startable.map((t) => t.getId()));
        }
    }
    orchestrator.processTasks(only);
}

/**
 * Tells the user why a "Run" did nothing (see {@link runSelected}'s answer). A press that is silently ignored reads as
 * a broken button. Never throws; resolves once the notice is closed (or at once when there is nobody to show it to).
 */
export async function explainRefusedRun(refusal: string | undefined): Promise<void> {
    if (!refusal) return;
    await dialogBridge.confirm({
        title: "Nothing was started",
        message: refusal,
        choices: [{ label: "OK", tone: "primary" }],
    });
}

/**
 * Reset + queue the given tasks, then process only those ids.
 *
 * Answers why nothing was started when that is the case (a batch is already running, or every task asked for is busy
 * or being edited by Claude): a sentence the user can read, see {@link explainRefusedRun}. `undefined` when at least
 * one task was started.
 */
export async function runSelected(
    selectedIds: ReadonlySet<string>,
    options: { actor?: LockHolder } = {}
): Promise<string | undefined> {
    // Who asks: a task is refused when the OTHER one holds it. Claude starting a track it holds itself (it set the
    // run flags just before) is fine; the user starting a track Claude holds is not.
    const actor = options.actor ?? "user";
    const orchestrator = TaskOrchestrator.getInstance();
    // The caller's set may be live UI state (the list's selection): the ones left out are removed from our own copy.
    const ids = new Set(selectedIds);
    // A batch is already going: the orchestrator would ignore this call, and the tasks reset and marked "Queued"
    // below would sit there until that batch ends. Nothing is touched.
    if (orchestrator.isProcessing()) {
        globalLogger.info("Not started: a batch is already running");
        return "Another run is going on. Wait for it to finish, or stop it first.";
    }
    let claudeBusy = 0;
    let alreadyRunning = 0;
    const tasks = orchestrator.getTasks();
    for (const t of tasks) {
        if (!ids.has(t.getId())) continue;
        // Claude is changing this task right now: starting it would reset what it is editing. Not run this time.
        if (taskLocks.isLocked(t.getId(), actor)) {
            globalLogger.info(
                `Not started: ${actor === "agent" ? "the user is" : "Claude is"} working on ${t.getId()}`
            );
            ids.delete(t.getId());
            claudeBusy++;
            continue;
        }
        const attrs = t.getAttributes() as { state?: string; kind?: string } | undefined;
        const state = attrs?.state;
        // Already running (or one of its parts is, which leaves `state` alone): resetting it now would empty the rows
        // the running work is writing to.
        if (state === "running" || isPartRunning(t)) {
            globalLogger.info(`Not started: ${t.getId()} is already running`);
            ids.delete(t.getId());
            alreadyRunning++;
            continue;
        }
        if (state !== "pending" && state !== "stopped") {
            if (attrs?.kind === "collection") {
                // Lighter reset than restart(): status/state only, existing children
                // (and their own state) are left untouched — a full teardown is
                // CollectionTask.restart()'s job, not a batch "run selected" reset.
                (t as unknown as CollectionTask).updateAttributes({ state: "pending", error: undefined });
            } else {
                (t as unknown as DownloadTask).updateAttributes({
                    state: "pending",
                    metadataGroups: [],
                    metadataOverride: {},
                    downloadSources: [],
                    primaryMetadataFetched: false,
                    metadataDiscovered: false,
                    downloadsFetched: false,
                });
            }
            t.finishedAt = undefined;
            t.runnedAt = undefined;
        }
        t.getStatus().set({ type: StatusType.Pending, message: "Queued" });
    }
    // Every task asked for was left out above: nothing to process, and the user must be told why.
    if (selectedIds.size > 0 && ids.size === 0 && (claudeBusy > 0 || alreadyRunning > 0)) {
        return claudeBusy > 0 && alreadyRunning === 0
            ? `${actor === "agent" ? "The user is" : "Claude is"} working on this right now. Try again in a moment.`
            : "Already running.";
    }
    // Pass the ID filter so the orchestrator only processes the selected tasks,
    // leaving other pending tasks untouched.
    orchestrator.processTasks(ids);
    return undefined;
}

export async function stopAll(): Promise<void> {
    TaskOrchestrator.getInstance().stopProcessing();
}
