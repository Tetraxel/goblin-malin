import { AsyncLocalStorage } from "async_hooks";

/**
 * A counting semaphore for bounding concurrency of async work.
 *
 * Used to give each pipeline *stage* its own budget: metadata fetches hit
 * rate-limited third-party APIs and must stay low, while downloads are network/IO
 * bound and can safely run many at once. The orchestrator's task-level cap governs
 * how many tasks are in-flight; these per-stage limiters shape what those tasks are
 * actually allowed to do at the same time — the lever that lets download parallelism
 * scale without hammering metadata providers.
 */
/** The permit one `run` holds: how many of its branches are waiting (permit given back), and the way back. */
type Permit = { lent: number; back?: Promise<void> };

export class Semaphore {
    /** The semaphores whose permit the running code holds (so `whileWaiting` knows it has one to give back). */
    private static readonly held = new AsyncLocalStorage<ReadonlyMap<Semaphore, Permit>>();

    private available: number;
    private readonly waiters: Array<() => void> = [];

    constructor(private limit: number) {
        this.limit = Math.max(1, Math.floor(limit));
        this.available = this.limit;
    }

    /** Acquire a permit, run `fn`, and always release — even if `fn` throws. */
    async run<T>(fn: () => Promise<T> | T): Promise<T> {
        await this.acquire();
        try {
            // One permit per run, however many parallel branches of it wait at once (`lent` counts them).
            return await Semaphore.held.run(
                new Map(Semaphore.held.getStore()).set(this, { lent: 0 } as Permit),
                async () => fn()
            );
        } finally {
            this.release();
        }
    }

    /**
     * Inside {@link run}: gives the permit back while `fn` waits for something that is not work (a person answering a
     * dialog, a slow last-resort call), and takes one again afterwards (it may queue behind others). A few tasks
     * waiting on a dialog nobody answers must not stop all the work that shares the budget. Outside `run` (the caller
     * holds no permit) it just calls `fn`.
     *
     * Parallel branches of one run (the platform searches of a track) may wait at the same time: the run has one
     * permit, so it is given back by the first to wait and taken again by the last to finish waiting.
     */
    async whileWaiting<T>(fn: () => Promise<T> | T): Promise<T> {
        const permit = Semaphore.held.getStore()?.get(this);
        if (!permit) return fn();
        // The permit is on its way back (the last branch is queueing for it): it is not ours to give away yet.
        if (permit.back) await permit.back;
        if (permit.lent++ === 0) this.release();
        try {
            return await fn();
        } finally {
            if (--permit.lent === 0) {
                permit.back = this.acquire();
                try {
                    await permit.back;
                } finally {
                    permit.back = undefined;
                }
            }
        }
    }

    private acquire(): Promise<void> {
        if (this.available > 0) {
            this.available--;
            return Promise.resolve();
        }
        return new Promise<void>((resolve) => this.waiters.push(resolve));
    }

    private release(): void {
        const next = this.waiters.shift();
        if (next) {
            // Hand the permit straight to the next waiter (available stays consumed).
            next();
        } else {
            this.available++;
        }
    }

    /**
     * Adjust the concurrency limit at runtime (e.g. when the user changes the
     * setting). Growing wakes queued waiters immediately; shrinking takes effect as
     * in-flight work releases its permits — never cancels running work.
     */
    setLimit(limit: number): void {
        const next = Math.max(1, Math.floor(limit));
        const delta = next - this.limit;
        this.limit = next;
        if (delta > 0) {
            for (let i = 0; i < delta; i++) this.release();
        } else if (delta < 0) {
            // Reduce headroom by consuming currently-free permits; in-flight work is
            // untouched and the effective limit converges as it completes.
            this.available = Math.max(0, this.available + delta);
        }
    }

    getLimit(): number {
        return this.limit;
    }
}
