/**
 * What the app is doing while it closes, so the UI can say so. `null` until Exit is pressed; after that
 * the app is closing for good (nothing resets it). `done` is set for the last frame, just before the
 * process ends.
 */
export type ShutdownSnapshot = { step: string; done: boolean };

type Listener = () => void;

let snapshot: ShutdownSnapshot | null = null;
const listeners = new Set<Listener>();

function publish(next: ShutdownSnapshot): void {
    snapshot = next;
    listeners.forEach((listener) => listener());
}

export const shutdownState = {
    /** The current closing state, or null while the app is running normally. A new object per change. */
    get(): ShutdownSnapshot | null {
        return snapshot;
    },
    /** A closing step is running ("Saving your session…"). */
    setStep(step: string): void {
        publish({ step, done: false });
    },
    /** Everything is saved: the next thing to happen is the process ending. */
    setDone(step: string): void {
        publish({ step, done: true });
    },
    subscribe(listener: Listener): () => void {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
};
