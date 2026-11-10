import { SettingsStore } from "#settings/settingsStore";

/**
 * Whether the welcome intro still owns the screen. It paints straight to the terminal, so any dialog Ink draws
 * over it (a damaged-file notice, the temporary-downloads reminder, a tool that couldn't be set up…) would land
 * in the middle of the animation. Dialogs raised by background work therefore wait until the intro is closed:
 * they stay queued and appear right after, in the order they were requested.
 *
 * Like `shutdownState` this is an external store, readable from anywhere and subscribable from React.
 */

type Listener = () => void;

// Decided on first read, from the setting, so nothing flashes before the intro has had time to mount.
let open: boolean | null = null;
const listeners = new Set<Listener>();

function publish(next: boolean): void {
    if (open === next) return;
    open = next;
    listeners.forEach((listener) => listener());
}

export const introState = {
    /** True from start-up until the intro is closed; always false when the setting turns the intro off. */
    isOpen(): boolean {
        open ??= SettingsStore.getInstance().getAppSettings().general.showWelcomeTutorial;
        return open;
    },
    /** The intro is over (or was never going to play): held dialogs may show. */
    close(): void {
        publish(false);
    },
    subscribe(listener: Listener): () => void {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
    /** Sets the state explicitly and forgets the listeners. For tests. */
    reset(value: boolean | null = null): void {
        open = value;
        listeners.clear();
    },
};
