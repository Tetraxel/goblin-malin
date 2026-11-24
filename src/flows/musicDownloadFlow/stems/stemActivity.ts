import { type StemProgress } from "./stemService";

/**
 * What the stem engine is doing for the whole app (installing, downloading a model): shown in the Stems tab while it
 * lasts. A separation's own progress is on its run, not here. Updates are passed on at most every 300 ms, like the
 * chat's text: every React commit repaints the whole screen.
 */
export type StemActivity = (StemProgress & { title: string }) | null;

const MIN_INTERVAL_MS = 300;
let current: StemActivity = null;
let lastEmit = 0;
let pending: NodeJS.Timeout | undefined;
const listeners = new Set<() => void>();

function emit(): void {
    lastEmit = Date.now();
    pending = undefined;
    for (const listener of listeners) listener();
}

export const stemActivity = {
    get(): StemActivity {
        return current;
    },
    subscribe(listener: () => void): () => void {
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    },
    /** Sets what is going on; `null` when it is over (shown at once). */
    set(next: StemActivity): void {
        current = next;
        if (next === null) {
            clearTimeout(pending);
            emit();
            return;
        }
        if (pending) return;
        const wait = MIN_INTERVAL_MS - (Date.now() - lastEmit);
        if (wait <= 0) emit();
        else pending = setTimeout(emit, wait);
    },
    /** Runs `work` as the engine's activity `title`, and clears it afterwards. */
    async track<T>(title: string, work: (onProgress: (p: StemProgress) => void) => Promise<T>): Promise<T> {
        stemActivity.set({ title, text: "Starting" });
        try {
            return await work((p) => stemActivity.set({ title, ...p }));
        } finally {
            stemActivity.set(null);
        }
    },
};
