import { AgentJournal } from "#base/agent/journal";
import { AgentToolError, type AgentToolContext } from "#base/agent/agentTool";
import { TaskOrchestrator } from "#base/task/orchestrator";
import { taskLocks } from "#base/task/taskLock";
import { type Task } from "#base/task/task";
import { CollectionTask } from "../utils/collectionTask";
import { DownloadTask, TaskLockedError, type WriteOptions } from "../utils/downloadTask";
import { OverrideValidationError } from "../utils/overrideValidation";

/** Every task of the current session, in list order. */
export function allTasks(): Task[] {
    return TaskOrchestrator.getInstance().getTasks();
}

/** The task with this id. An id given without its "task:" prefix (a model may drop it) is read as the same task. */
export function findTask(id: string): Task | undefined {
    const tasks = allTasks();
    return tasks.find((t) => t.getId() === id) ?? tasks.find((t) => t.getId() === `task:${id}`);
}

/** The track with this id; a clear error for the model when there is none, or when it is an album/playlist. */
export function requireDownloadTask(id: string): DownloadTask {
    const task = findTask(id);
    if (!task) throw new AgentToolError(`No task with id "${id}". Use list_tasks to find ids.`, "not-found");
    if (task instanceof CollectionTask) {
        throw new AgentToolError(
            `Task ${id} is an album/playlist, not a track. Use get_task to see its children, and work on those.`,
            "not-a-track"
        );
    }
    if (!(task instanceof DownloadTask)) throw new AgentToolError(`Task ${id} is not a track.`, "not-a-track");
    return task;
}

/** A track's revision, undefined when it is gone (or is not a track): the journal's "has it changed since?". */
export function revisionOfTask(id: string): number | undefined {
    const task = findTask(id);
    return task instanceof DownloadTask ? task.getRevision() : undefined;
}

/**
 * Whether an undo must wait for this task: someone holds it (a call of Claude's that is still working on it) or the
 * pipeline is processing it. Putting values back under either would be refused halfway, or overwritten.
 */
function isTaskBusyForUndo(id: string): boolean {
    const task = findTask(id);
    if (!(task instanceof DownloadTask)) return false;
    return taskLocks.isLocked(task.getId()) || isTaskRunning(task);
}

/** What Claude changed this launch; "Undo Claude's last action" reads it. */
export const agentJournal = new AgentJournal(revisionOfTask, isTaskBusyForUndo);

/**
 * Whether the pipeline is working on this track right now (it is the busiest writer: the agent stays out of its way).
 * A part run again on a finished track (`runMetadataPart` / `runDownloadPart`) counts: it does not change `state`.
 */
export function isTaskRunning(task: DownloadTask): boolean {
    return task.running || task.partRunning || task.getAttributes()?.state === "running";
}

/**
 * The refusals every agent write shares. Run before anything is changed:
 *  - the pipeline is processing the track ("task is running"),
 *  - the model's read is out of date (the revision it carries is not the current one).
 */
export function assertAgentMayWrite(task: DownloadTask, revision: number): void {
    if (isTaskRunning(task)) {
        throw new AgentToolError(
            `Task ${task.getId()} is being processed right now. Wait until it finishes (check with get_task), then try again.`,
            "running"
        );
    }
    if (task.getRevision() !== revision) {
        throw new AgentToolError(
            `Task ${task.getId()} changed since you read it (revision ${revision}, now ${task.getRevision()}). Read it again with get_task, then redo the change if it still makes sense.`,
            "stale"
        );
    }
}

export type AgentChange<T> = {
    /** What the tool answers. */
    result: T;
    /** Puts back what the change replaced (omit for a change that cannot be undone). */
    restore?: () => void | Promise<void>;
};

/**
 * Every write tool changes a track through here: the shared refusals, the budget, the change itself (a named method
 * called as the agent, which checks the lock and validates the value), and the journal entry that makes it
 * undoable. Returns what the tool answers plus the track's new revision, so the model can go on without re-reading.
 */
export async function agentWrite<T extends object>(opts: {
    ctx: AgentToolContext;
    tool: string;
    task: DownloadTask;
    revision: number;
    /** One line for the chat and the journal. */
    label: string;
    change: (as: WriteOptions) => AgentChange<T> | Promise<AgentChange<T>>;
}): Promise<T & { revision: number }> {
    const { ctx, task } = opts;
    assertAgentMayWrite(task, opts.revision);
    // Counted once the change went through: a refused or invalid one (a "locked", a bad ISRC) changed nothing and
    // must not use up the turn's allowance for this task.
    const overBudget = ctx.turn.checkBudget([task.getId()]);
    if (overBudget) throw new AgentToolError(overBudget, "budget");

    let change: AgentChange<T>;
    try {
        change = await opts.change({ actor: "agent" });
    } catch (error) {
        if (error instanceof TaskLockedError) throw new AgentToolError(error.message, "locked");
        if (error instanceof OverrideValidationError) throw new AgentToolError(error.message, "invalid");
        throw error;
    }

    ctx.turn.count([task.getId()]);
    const revision = task.getRevision();
    if (change.restore) {
        const restore = change.restore;
        agentJournal.record({
            tool: opts.tool,
            label: opts.label,
            checks: [{ taskId: task.getId(), revisionAfter: revision }],
            restore,
        });
    }
    return { ...change.result, revision };
}
