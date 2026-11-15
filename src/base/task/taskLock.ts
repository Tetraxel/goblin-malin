/**
 * Who may write to a task right now. In memory only, on purpose: a lock that outlived the process (a crash) would
 * leave a task stuck, so every start-up begins with none.
 *
 * Locks gate EXTERNAL writers only. The pipeline is the busiest writer of a task and is never locked out: instead,
 * a task the pipeline is processing refuses the agent (that check lives with the writer, not here).
 *
 * A lock has an owner (the holder + a token) and a TTL. An expired lock counts as free, so a lease that was never
 * released (a bug, a hung call) cannot freeze a task for good.
 */

export type LockHolder = "user" | "agent";

export const DEFAULT_LOCK_TTL_MS = 60_000;

// `leases`: every lease that covers the task. Two calls of one turn on the same task (Claude can call tools in
// parallel) share the entry, and the task stays held until the LAST of them is released.
type Entry = { holder: LockHolder; since: number; expiresAt: number; leases: Set<symbol> };

/** The result of {@link TaskLocks.acquire}: a lease over a set of tasks. */
export interface TaskLease {
    readonly taskIds: readonly string[];
    /** Pushes the expiry back by `ttlMs` (a long batch renews between items). */
    renew(ttlMs?: number): void;
    /** Gives the tasks back. Safe to call twice. */
    release(): void;
}

export class TaskLocks {
    private entries = new Map<string, Entry>();
    private listeners = new Set<() => void>();
    private now: () => number;
    private sweepTimer: ReturnType<typeof setTimeout> | undefined;
    // When `sweepTimer` fires, on the same clock as `now`.
    private sweepDueAt = 0;

    constructor(now: () => number = Date.now) {
        this.now = now;
    }

    private live(taskId: string): Entry | undefined {
        const entry = this.entries.get(taskId);
        if (!entry) return undefined;
        if (entry.expiresAt <= this.now()) {
            this.entries.delete(taskId);
            return undefined;
        }
        return entry;
    }

    /** Who holds the task, if anyone. */
    heldBy(taskId: string): LockHolder | undefined {
        return this.live(taskId)?.holder;
    }

    /** Whether someone other than `asHolder` holds the task (no `asHolder`: whether anyone does). */
    isLocked(taskId: string, asHolder?: LockHolder): boolean {
        const holder = this.heldBy(taskId);
        return holder !== undefined && holder !== asHolder;
    }

    /**
     * Takes every task of `taskIds`, or none: returns the ids that are held by someone else instead of a lease.
     * A holder asking again for tasks it already holds gets them (a nested or parallel call of one turn): the task is
     * then held until every lease on it is released, and for as long as the longest of them.
     */
    acquire(
        taskIds: readonly string[],
        holder: LockHolder,
        options: { ttlMs?: number } = {}
    ): { ok: true; lease: TaskLease } | { ok: false; heldBy: Record<string, LockHolder> } {
        const ids = [...new Set(taskIds)];
        const conflicts: Record<string, LockHolder> = {};
        for (const id of ids) {
            const entry = this.live(id);
            if (entry && entry.holder !== holder) conflicts[id] = entry.holder;
        }
        if (Object.keys(conflicts).length > 0) return { ok: false, heldBy: conflicts };

        const ttlMs = options.ttlMs ?? DEFAULT_LOCK_TTL_MS;
        const token = Symbol("lease");
        const since = this.now();
        let created = false;
        for (const id of ids) {
            const entry = this.live(id);
            if (entry) {
                // Already ours: this lease joins the one that holds it.
                entry.leases.add(token);
                entry.expiresAt = Math.max(entry.expiresAt, since + ttlMs);
            } else {
                this.entries.set(id, { holder, since, expiresAt: since + ttlMs, leases: new Set([token]) });
                created = true;
            }
        }
        if (created) this.emit();
        this.scheduleSweep();

        const lease: TaskLease = {
            taskIds: ids,
            renew: (renewMs = ttlMs) => {
                for (const id of ids) {
                    const entry = this.entries.get(id);
                    if (entry?.leases.has(token)) entry.expiresAt = Math.max(entry.expiresAt, this.now() + renewMs);
                }
            },
            release: () => {
                let changed = false;
                for (const id of ids) {
                    const entry = this.entries.get(id);
                    if (!entry?.leases.delete(token)) continue;
                    if (entry.leases.size === 0) {
                        this.entries.delete(id);
                        changed = true;
                    }
                }
                if (changed) this.emit();
            },
        };
        return { ok: true, lease };
    }

    /**
     * An expired lock is dropped lazily by `live()`, which runs inside reads (a render): it cannot notify from there.
     * So one timer wakes up when the earliest lock expires, drops what has run out and tells the subscribers, or the
     * "Claude is working" marker of a row would stay on a task that is free again.
     */
    private scheduleSweep(): void {
        if (this.entries.size === 0) return;
        const next = Math.min(...[...this.entries.values()].map((e) => e.expiresAt));
        const wait = Math.max(50, next - this.now());
        const dueAt = this.now() + wait;
        if (this.sweepTimer) {
            // A timer is already set: keep it unless the earliest expiry is now sooner (a short lease taken after a
            // long one). A later expiry (a renewed lease) is fine: the timer wakes early and sets itself again.
            if (this.sweepDueAt <= dueAt) return;
            clearTimeout(this.sweepTimer);
        }
        this.sweepDueAt = dueAt;
        this.sweepTimer = setTimeout(() => {
            this.sweepTimer = undefined;
            const before = this.entries.size;
            for (const id of [...this.entries.keys()]) this.live(id);
            if (this.entries.size !== before) this.emit();
            this.scheduleSweep();
        }, wait);
        // A pending sweep must never keep the process (or a test run) alive.
        this.sweepTimer.unref?.();
    }

    /** Forgets every lock (start-up, tests). */
    clear(): void {
        if (this.sweepTimer) {
            clearTimeout(this.sweepTimer);
            this.sweepTimer = undefined;
        }
        if (this.entries.size === 0) return;
        this.entries.clear();
        this.emit();
    }

    /** Calls `listener` whenever a task is locked or released. It does not replay the current state. */
    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private emit(): void {
        this.listeners.forEach((listener) => listener());
    }
}

/** The app-wide locks. */
export const taskLocks = new TaskLocks();
