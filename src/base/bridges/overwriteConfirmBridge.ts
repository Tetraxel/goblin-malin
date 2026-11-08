export type OverwriteConfirmRequest = {
    /** The existing file the save would replace. */
    filePath: string;
    /** The user agreed to replace it. */
    replace: () => void;
    /** The user refused, or dismissed the dialog (Esc): leave the existing file alone. */
    cancel: () => void;
};

type Opener = (request: OverwriteConfirmRequest) => void;

let opener: Opener | null = null;

export const overwriteConfirmBridge = {
    setOpener(fn: Opener | null): void {
        opener = fn;
    },
    /**
     * Asks whether `filePath` may be replaced. Resolves false when the user says no — and when no UI is
     * mounted to ask (e.g. headless runs): a file is never overwritten without an answer.
     */
    confirm(filePath: string): Promise<boolean> {
        return new Promise((resolve) => {
            if (!opener) {
                resolve(false);
                return;
            }
            opener({ filePath, replace: () => resolve(true), cancel: () => resolve(false) });
        });
    },
};
