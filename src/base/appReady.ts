/**
 * "The app is on screen and may ask the user something": the UI has mounted its dialogs and the welcome intro is over
 * (or was never going to play). Plain-TypeScript code that wants to ask once at start-up (a first-run question)
 * registers here instead of guessing when `dialogBridge` can be answered: asked any earlier, a dialog would land in the
 * intro's animation, or be answered `null` because nothing is mounted yet.
 */

type Callback = () => void;

let ready = false;
let waiting: Callback[] = [];

export const appReady = {
    /** Runs `callback` once the app is ready: at once when it already is. */
    whenReady(callback: Callback): void {
        if (ready) callback();
        else waiting.push(callback);
    },
    /** Called by the UI once its dialogs are mounted and the intro has closed. Only the first call does anything. */
    markReady(): void {
        if (ready) return;
        ready = true;
        const callbacks = waiting;
        waiting = [];
        for (const callback of callbacks) callback();
    },
    isReady(): boolean {
        return ready;
    },
    /** Back to "not ready", with nothing waiting. For tests. */
    reset(): void {
        ready = false;
        waiting = [];
    },
};
