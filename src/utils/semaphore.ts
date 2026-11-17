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
export class Semaphore {
    /** The semaphores whose permit the running code holds (so `whileWaiting` knows it has one to give back). */
    private static readonly held = new AsyncLocalStorage<ReadonlySet<Semaphore>>();

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
            return await Semaphore.held.run(new Set(Semaphore.held.getStore()).add(this), async () => fn());
        } finally {
            this.release();
        }
    }

    /**
     * Inside {@link run}: gives the permit back while `fn` waits for something that is not work (a person answering a
     * dialog, a slow last-resort call), and takes one again afterwards (it may queue behind others). A few tasks
     * waiting on a dialog nobody answers must not stop all the work that shares the budget. Outside `run` (the caller
     * holds no permit) it just calls `fn`.
     */
    async whileWaiting<T>(fn: () => Promise<T> | T): Promise<T> {
        const held = Semaphore.held.getStore();
        if (!held?.has(this)) return fn();
        const without = new Set(held);
        without.delete(this);
        this.release();
        try {
            return await Semaphore.held.run(without, async () => fn());
        } finally {
            await this.acquire();
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
