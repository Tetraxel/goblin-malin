import { randomUUID } from "node:crypto";
import { taskLocks, type TaskLease, type TaskLocks } from "#base/task/taskLock";

/** How many times one turn may change the same task. A bulk tool counts once per task it touches, not once per call. */
export const MAX_MUTATIONS_PER_TASK = 8;
/** How many different tasks one turn may change (a 500-task batch is a plan the user approves, not a loop). */
export const MAX_TASKS_TOUCHED = 500;

/**
 * One message of the user and everything Claude does to answer it. It is the unit that owns:
 *  - the abort signal (Stop),
 *  - the mutation budget (a prompt-injected title cannot make Claude rewrite the library in a loop),
 *  - the leases it took, so none can leak: they are all released when the turn ends, however it ends.
 */
export class AgentTurn {
    readonly id = randomUUID();
    private readonly controller = new AbortController();
    private readonly leases = new Set<TaskLease>();
    private readonly mutations = new Map<string, number>();
    private ended = false;
    /** Told about long work as it goes ("Applying 12 of 40"), so the chat can show it. */
    onProgress?: (text: string) => void;

    constructor(
        private readonly locks: TaskLocks = taskLocks,
        private readonly limits = { perTask: MAX_MUTATIONS_PER_TASK, tasks: MAX_TASKS_TOUCHED }
    ) {}

    get signal(): AbortSignal {
        return this.controller.signal;
    }

    get isEnded(): boolean {
        return this.ended;
    }

    /** Tasks this turn has changed so far, with how many times. */
    get touched(): ReadonlyMap<string, number> {
        return this.mutations;
    }

    /**
     * Takes the tasks for the agent. Returns the lease, or the ids someone else holds. The turn remembers the lease
     * and releases it at {@link end} if the caller did not.
     */
    acquire(taskIds: readonly string[], ttlMs?: number): { lease: TaskLease } | { heldBy: Record<string, string> } {
        if (this.ended) return { heldBy: {} };
        const result = this.locks.acquire(taskIds, "agent", { ttlMs });
        if (!result.ok) return { heldBy: result.heldBy };
        const lease = result.lease;
        this.leases.add(lease);
        // Releasing early (the call is done) also forgets it here.
        const release = lease.release;
        const turnLeases = this.leases;
        return {
            lease: {
                taskIds: lease.taskIds,
                renew: lease.renew,
                release: () => {
                    release();
                    turnLeases.delete(lease);
                },
            },
        };
    }

    /**
     * Counts one change on each of `taskIds`. Returns a message when the budget is gone (the change must not
     * happen), `undefined` when it is allowed (and counted). For a change that can still be refused or fail, use
     * {@link checkBudget} before and {@link count} after it succeeded: a refused change must not use the budget up.
     */
    spend(taskIds: readonly string[]): string | undefined {
        const overBudget = this.checkBudget(taskIds);
        if (overBudget) return overBudget;
        this.count(taskIds);
        return undefined;
    }

    /** Whether a change on each of `taskIds` is still allowed: a message when it is not, nothing is counted. */
    checkBudget(taskIds: readonly string[]): string | undefined {
        const ids = [...new Set(taskIds)];
        const newTasks = ids.filter((id) => !this.mutations.has(id)).length;
        if (this.mutations.size + newTasks > this.limits.tasks) {
            return `This turn has already changed ${this.mutations.size} tasks, the most it is allowed to. Ask the user to continue in a new message.`;
        }
        for (const id of ids) {
            if ((this.mutations.get(id) ?? 0) >= this.limits.perTask) {
                return `Task ${id} has already been changed ${this.limits.perTask} times in this turn. Stop changing it and tell the user what you were trying to do.`;
            }
        }
        return undefined;
    }

    /** Counts one change that happened on each of `taskIds` (see {@link checkBudget}). */
    count(taskIds: readonly string[]): void {
        for (const id of new Set(taskIds)) this.mutations.set(id, (this.mutations.get(id) ?? 0) + 1);
    }

    /** Aborts whatever is still running and gives every task back. Idempotent. */
    end(): void {
        if (this.ended) return;
        this.ended = true;
        for (const lease of [...this.leases]) lease.release();
        this.leases.clear();
        this.controller.abort();
    }

    /** Reports what a long tool is doing. Never throws. */
    progress(text: string): void {
        try {
            this.onProgress?.(text);
        } catch {
            /* a broken listener must not stop the tool */
        }
    }

    /** The user pressed Stop: the same as the turn ending. */
    stop(): void {
        this.end();
    }
}
