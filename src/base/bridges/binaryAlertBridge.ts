export type BinaryAlertRequest = {
    /** The tool that could not be found or downloaded, e.g. `ffmpeg`. */
    binary: string;
    /** What stops working without it, in one sentence for the dialog. */
    impact: string;
    /** Why it could not be set up (the error's message, already readable). */
    reason: string;
};

type Opener = (request: BinaryAlertRequest) => void;

let opener: Opener | null = null;

/** Tools the user has already been told about and that have not worked since. */
const alerted = new Set<string>();

export const binaryAlertBridge = {
    setOpener(fn: Opener | null): void {
        opener = fn;
    },
    /**
     * Tells the user a tool could not be found or downloaded. Fire-and-forget (a plain-TS setup routine has
     * nothing to wait for), and shown once per tool until it next works: one broken download would otherwise
     * raise the same dialog again for every track. A no-op when no UI is mounted (e.g. headless runs).
     */
    report(req: BinaryAlertRequest): void {
        if (!opener || alerted.has(req.binary)) return;
        alerted.add(req.binary);
        opener(req);
    },
    /** The tool is available: a later failure is news again and may alert again. */
    resolved(binary: string): void {
        alerted.delete(binary);
    },
    /** Forgets what was already reported. For tests. */
    reset(): void {
        alerted.clear();
    },
};
