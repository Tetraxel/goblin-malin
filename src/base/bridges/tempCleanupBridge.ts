/**
 * What the temporary-downloads clean-up shows the user. The clean-up itself is plain TypeScript (it runs from a
 * settings action and from start-up); this is the one dialog it talks through: a choice of how far back to
 * clean, then a "working" box that blocks the whole UI while files are deleted and sessions rewritten, then a
 * result to acknowledge.
 *
 * Like `shutdownState` this is an external store, so the modal just renders whatever view is current.
 */

export type TempCleanupOption = {
    key: string;
    label: string;
    files: number;
    bytes: number;
    /** Of `files`, how many belong to the session open right now (their sources will say "File not found"). */
    liveFiles: number;
};

export type TempCleanupChoice =
    | { action: "clean"; ageKey: string }
    /** Not now. */
    | { action: "later" }
    /** Stop reminding (reminder only). */
    | { action: "never" };

export type TempCleanupView =
    | {
          kind: "choose";
          /** `manual`: the user asked for it. `reminder`: the app suggests it, so it can be silenced for good. */
          mode: "manual" | "reminder";
          dir: string;
          totalFiles: number;
          totalBytes: number;
          options: TempCleanupOption[];
          initialKey: string;
          answer: (choice: TempCleanupChoice) => void;
      }
    | { kind: "working"; title: string; step: string }
    | { kind: "message"; tone: "success" | "warning" | "error"; title: string; lines: string[]; close: () => void };

type Listener = () => void;

let view: TempCleanupView | null = null;
let mounted = false;
const listeners = new Set<Listener>();

function publish(next: TempCleanupView | null): void {
    view = next;
    listeners.forEach((listener) => listener());
}

export const tempCleanupBridge = {
    /** The modal tells the bridge it is on screen. Without it nothing is ever deleted on a question. */
    setMounted(value: boolean): void {
        mounted = value;
    },
    hasUi(): boolean {
        return mounted;
    },
    get(): TempCleanupView | null {
        return view;
    },
    subscribe(listener: Listener): () => void {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },

    /** Asks what to clean. Resolves `later` — nothing is deleted — when no UI is mounted to ask. */
    choose(spec: Omit<Extract<TempCleanupView, { kind: "choose" }>, "kind" | "answer">): Promise<TempCleanupChoice> {
        return new Promise((resolve) => {
            if (!mounted) {
                resolve({ action: "later" });
                return;
            }
            publish({ kind: "choose", ...spec, answer: resolve });
        });
    },
    /** Blocks the UI behind a progress box; call again to change the step, `close()` to release it. */
    working(title: string, step: string): void {
        if (mounted) publish({ kind: "working", title, step });
    },
    /** Shows a result and resolves once it is acknowledged (at once with no UI). */
    message(spec: Omit<Extract<TempCleanupView, { kind: "message" }>, "kind" | "close">): Promise<void> {
        return new Promise((resolve) => {
            if (!mounted) {
                resolve();
                return;
            }
            publish({ kind: "message", ...spec, close: resolve });
        });
    },
    /** Releases the UI. Always reached, success or not: a stuck box would lock the app. */
    close(): void {
        publish(null);
    },
};
