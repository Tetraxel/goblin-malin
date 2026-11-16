import { AgentToolError, defineAgentTool, type AgentToolContext } from "#base/agent/agentTool";
import { type JsonSchema } from "#base/agent/jsonSchema";
import { TaskOrchestrator } from "#base/task/orchestrator";
import { taskLocks } from "#base/task/taskLock";
import { globalLogger } from "#base/logger/logger";
import { CollectionTask } from "../../utils/collectionTask";
import { DownloadTask } from "../../utils/downloadTask";
import { runSelected } from "../../runController";
import { findTask } from "../taskAccess";
import { isTaskBusy } from "../runReport";
import { runAllowance } from "../runAllowance";
import { joinSameCall } from "../joinSameCall";
import { labelOf } from "./writeTools";

const logger = globalLogger.createChild({ service: "AgentRun" });

/** How many tasks one call may start: a bigger run is the user's to start (or to ask for in pieces). */
const MAX_RUN_PER_CALL = 20;

const taskIdsSchema: JsonSchema & { type: "object" } = {
    type: "object",
    additionalProperties: false,
    required: ["taskIds"],
    properties: {
        taskIds: {
            type: "array",
            items: { type: "string", minLength: 1, maxLength: 200 },
            minItems: 1,
            maxItems: MAX_RUN_PER_CALL,
        },
    },
};

type RunInput = { taskIds: string[] };
type Skipped = { taskId: string; reason: string };

const BACKGROUND_NOTE =
    "They run in the background. See how they are doing with get_task (its state and status). Do not poll in a loop: tell the user they are started, and look again when asked.";

/** The tracks of `taskIds` that may be started now, and why the others may not. */
function pickRunnable(taskIds: readonly string[]): { tasks: DownloadTask[]; skipped: Skipped[] } {
    const tasks: DownloadTask[] = [];
    const skipped: Skipped[] = [];
    for (const taskId of new Set(taskIds)) {
        const task = findTask(taskId);
        if (!task) skipped.push({ taskId, reason: "no task with this id" });
        else if (task instanceof CollectionTask)
            skipped.push({ taskId, reason: "an album, playlist or group: run its tracks (see get_task for them)" });
        else if (!(task instanceof DownloadTask)) skipped.push({ taskId, reason: "not a track" });
        else if (isTaskBusy(task)) skipped.push({ taskId, reason: "already being processed" });
        else if (taskLocks.isLocked(task.getId(), "agent")) skipped.push({ taskId, reason: "being edited right now" });
        else tasks.push(task);
    }
    return { tasks, skipped };
}

/**
 * A track that was never run starts through the orchestrator's batch, which takes one batch at a time: while the
 * user's (or an earlier call's) batch is going, a new one would be ignored. Those tracks are reported as skipped
 * instead of being "started" and left waiting.
 */
function takeFreeBatch(tasks: readonly DownloadTask[], skipped: Skipped[]): DownloadTask[] {
    if (tasks.length === 0 || !TaskOrchestrator.getInstance().isProcessing()) return [...tasks];
    for (const t of tasks) {
        skipped.push({ taskId: t.getId(), reason: "another batch is running: try again when it has finished" });
    }
    return [];
}

const stateOf = (task: DownloadTask): string | undefined =>
    (task.getAttributes() as { state?: string } | undefined)?.state;
const isUnrun = (task: DownloadTask): boolean => stateOf(task) === "pending" || stateOf(task) === "stopped";

/**
 * Asks before a download starts: downloads use the user's network and disk, and Soulseek talks to other people's
 * computers. The safe answer is first. "Don't ask again" lasts for this conversation only.
 */
async function askToDownload(ctx: AgentToolContext, tasks: readonly DownloadTask[]): Promise<boolean> {
    if (runAllowance.downloads) return true;
    const n = tasks.length;
    const answer = await ctx.confirm({
        title: `Let Claude start ${n} ${n === 1 ? "download" : "downloads"}?`,
        message:
            `Claude wants to download ${n === 1 ? "this track" : `these ${n} tracks`}:\n\n` +
            tasks
                .slice(0, 8)
                .map((t) => `• ${labelOf(t)}`)
                .join("\n") +
            (n > 8 ? `\n…and ${n - 8} more` : "") +
            "\n\nIt downloads from the sources the app finds (YouTube, and Soulseek if you use it) into the app's " +
            "temporary folder. Nothing is saved to your music folder by this.\n\n" +
            '"Don\'t ask again" lasts for this conversation.',
        // The safe answer first.
        choices: [
            { label: "Cancel", tone: "muted" },
            { label: "Start", tone: "primary" },
            // Short: a long label does not fit the dialog.
            { label: "Start, don't ask again", tone: "primary" },
        ],
        accent: "#d97757",
    });
    // An answer that arrives for a turn that is over is not a permission (see `conversationMovedOn`).
    if (answer === 2 && !conversationMovedOn(ctx)) runAllowance.downloads = true;
    return answer === 1 || answer === 2;
}

const declined = { started: [], cancelled: true, note: "The user did not allow it. Do not ask again unless they do." };

/** The turn was stopped or finished while the question was open: a late "Start" must not start anything. */
const conversationMovedOn = (ctx: AgentToolContext): boolean => ctx.turn.isEnded || ctx.signal.aborted;
const movedOn = {
    started: [],
    cancelled: true,
    note: "The conversation had moved on before the answer: nothing was started.",
};

/**
 * Starts never-run tracks through the batch and returns the ones that really started. The run controller says no
 * (answers a reason) when it started none: those are reported as skipped instead of "started", so the model is not
 * told a track is running that nothing is going to run.
 */
async function startBatch(label: string, tasks: readonly DownloadTask[], skipped: Skipped[]): Promise<DownloadTask[]> {
    if (tasks.length === 0) return [];
    try {
        const refusal = await runSelected(new Set(tasks.map((t) => t.getId())), { actor: "agent" });
        if (!refusal) return [...tasks];
        logger.warn(`${label} not started: ${refusal}`);
        for (const t of tasks) skipped.push({ taskId: t.getId(), reason: refusal });
    } catch (error) {
        logger.warn(`${label} failed: ${error instanceof Error ? error.message : String(error)}`);
        for (const t of tasks) skipped.push({ taskId: t.getId(), reason: "it could not be started" });
    }
    return [];
}

/** What TAG? and DL? are now: a start sets them first, and gives them back when the track was not started after all. */
type RunFlags = { toTag?: boolean; toDownload?: boolean };
const runFlagsOf = (task: DownloadTask): RunFlags => {
    const a = task.getAttributes();
    return { toTag: a?.toTag, toDownload: a?.toDownload };
};

/** Puts the flags back on tracks that did not start: the user's own choice must not be lost to a refused start. */
function restoreFlags(before: Map<DownloadTask, RunFlags>, started: readonly DownloadTask[]): void {
    for (const [task, flags] of before) {
        if (started.includes(task)) continue;
        try {
            task.setRunFlags(flags, { actor: "agent" });
        } catch (error) {
            logger.warn(
                `Could not put back the flags of ${task.getId()}: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }
}

/** Starts `work` without waiting for it: the call answers at once, the run goes on in the background. */
function inBackground(label: string, work: Promise<unknown>): void {
    work.catch((error) => logger.warn(`${label} failed: ${error instanceof Error ? error.message : String(error)}`));
}

export const runMetadata = defineAgentTool<RunInput>({
    name: "run_metadata",
    summary:
        "Runs the metadata part of tracks: for a track that was never run, finds its metadata and the other platforms' versions (nothing is downloaded: it turns DL? off); for a track already run, searches again, keeping what the user typed (overrides, links). It starts them and answers at once: they finish in the background.",
    kind: "write",
    locks: "none",
    undoable: false,
    input: taskIdsSchema,
    example: { taskIds: ["task:1a2b3c4d5e6f"] },
    describeCall: (input) => `run_metadata (${input.taskIds.length})`,
    run: async ({ taskIds }, ctx) => {
        const { tasks, skipped } = pickRunnable(taskIds);
        if (tasks.length === 0) return { started: [], skipped };
        const freeBatch = takeFreeBatch(tasks.filter(isUnrun), skipped);
        const again = tasks.filter((t) => !isUnrun(t));
        if (freeBatch.length === 0 && again.length === 0) return { started: [], skipped };
        const overBudget = ctx.turn.checkBudget([...freeBatch, ...again].map((t) => t.getId()));
        if (overBudget) throw new AgentToolError(overBudget, "budget");
        // A track that was never run goes through the normal start (queue, limits, state), with downloads off.
        const flagsBefore = new Map(freeBatch.map((t) => [t, runFlagsOf(t)]));
        for (const task of freeBatch) task.setRunFlags({ toTag: true, toDownload: false }, { actor: "agent" });
        const fresh = await startBatch("run_metadata", freeBatch, skipped);
        restoreFlags(flagsBefore, fresh);
        for (const task of again) inBackground("run_metadata", task.runMetadataPart({ actor: "agent" }));
        const started = [...fresh, ...again];
        if (started.length === 0) return { started: [], skipped };
        ctx.turn.count(started.map((t) => t.getId()));
        return {
            started: started.map((t) => ({
                taskId: t.getId(),
                how: fresh.includes(t) ? "first run" : "again",
            })),
            ...(skipped.length > 0 ? { skipped } : {}),
            note: BACKGROUND_NOTE,
        };
    },
});

export const runDownload = defineAgentTool<RunInput>({
    name: "run_download",
    summary:
        "Runs the download part of tracks whose metadata is ready (a track that was never run must go through run_metadata first): searches the download providers and downloads the sources into the app's temporary folder. Always asks the user first. It starts them and answers at once: they finish in the background. It does not save files to the music folder.",
    kind: "confirm",
    locks: "none",
    undoable: false,
    input: taskIdsSchema,
    example: { taskIds: ["task:1a2b3c4d5e6f"] },
    describeCall: (input) => `run_download (${input.taskIds.length})`,
    run: ({ taskIds }, ctx) =>
        joinSameCall("run_download", ctx, taskIds, async () => {
            const ready = (t: DownloadTask): boolean => {
                const a = t.getAttributes();
                return Boolean(a?.downloadsFetched || a?.metadataDiscovered);
            };
            const { tasks: candidates, skipped } = pickRunnable(taskIds);
            const tasks = candidates.filter(ready);
            for (const t of candidates.filter((c) => !ready(c))) {
                skipped.push({ taskId: t.getId(), reason: "its metadata is not ready: run_metadata first" });
            }
            if (tasks.length === 0) return { started: [], skipped };
            // Counted only once the user said yes: a declined question changes nothing, so it costs nothing.
            const overBudget = ctx.turn.checkBudget(tasks.map((t) => t.getId()));
            if (overBudget) throw new AgentToolError(overBudget, "budget");
            const allowed = await askToDownload(ctx, tasks);
            // Checked before the answer: Stop takes the dialog away (answer null), which is not the user saying no.
            if (conversationMovedOn(ctx)) return movedOn;
            if (!allowed) return declined;

            // The answer may have taken a while: only what can still be started is.
            const live = pickRunnable(tasks.map((t) => t.getId())).tasks.filter(ready);
            ctx.turn.count(live.map((t) => t.getId()));
            for (const task of live) inBackground("run_download", task.runDownloadPart({ actor: "agent" }));
            return {
                started: live.map((t) => ({ taskId: t.getId() })),
                ...(skipped.length > 0 ? { skipped } : {}),
                note: BACKGROUND_NOTE,
            };
        }),
});

export const runTask = defineAgentTool<RunInput>({
    name: "run_task",
    summary:
        "Runs tracks that were never run, from start to end: their metadata, then their downloads (turns TAG? and DL? on). A track that was run before is refused: use run_metadata or run_download for a part of it (a full restart would erase what the user typed). Always asks the user first. It starts them and answers at once: they finish in the background.",
    kind: "confirm",
    locks: "none",
    undoable: false,
    input: taskIdsSchema,
    example: { taskIds: ["task:1a2b3c4d5e6f"] },
    describeCall: (input) => `run_task (${input.taskIds.length})`,
    run: ({ taskIds }, ctx) =>
        joinSameCall("run_task", ctx, taskIds, async () => {
            const { tasks: candidates, skipped } = pickRunnable(taskIds);
            const tasks = candidates.filter(isUnrun);
            for (const t of candidates.filter((c) => !isUnrun(c))) {
                skipped.push({
                    taskId: t.getId(),
                    reason: "already run: use run_metadata or run_download for a part of it",
                });
            }
            if (tasks.length === 0) return { started: [], skipped };
            // Counted only once the user said yes: a declined question changes nothing, so it costs nothing.
            const overBudget = ctx.turn.checkBudget(tasks.map((t) => t.getId()));
            if (overBudget) throw new AgentToolError(overBudget, "budget");
            const allowed = await askToDownload(ctx, tasks);
            if (conversationMovedOn(ctx)) return movedOn;
            if (!allowed) return declined;

            // The answer may have taken a while (and another run may have started these tracks meanwhile).
            const freeBatch = takeFreeBatch(pickRunnable(tasks.map((t) => t.getId())).tasks.filter(isUnrun), skipped);
            if (freeBatch.length === 0) return { started: [], skipped, note: "They were started in the meantime." };
            const flagsBefore = new Map(freeBatch.map((t) => [t, runFlagsOf(t)]));
            for (const task of freeBatch) task.setRunFlags({ toTag: true, toDownload: true }, { actor: "agent" });
            const live = await startBatch("run_task", freeBatch, skipped);
            restoreFlags(flagsBefore, live);
            if (live.length === 0) return { started: [], skipped };
            ctx.turn.count(live.map((t) => t.getId()));
            return {
                started: live.map((t) => ({ taskId: t.getId() })),
                ...(skipped.length > 0 ? { skipped } : {}),
                note: BACKGROUND_NOTE,
            };
        }),
});

export const runTools = [runMetadata, runDownload, runTask];
