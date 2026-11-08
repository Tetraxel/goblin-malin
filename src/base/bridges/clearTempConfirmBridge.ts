export type ClearTempRequest =
    | {
          kind: "confirm";
          /** The folder the files would be deleted from. */
          dir: string;
          fileCount: number;
          bytes: number;
          /** The user agreed to delete them. */
          proceed: () => void;
          /** The user refused, or dismissed the dialog (Esc). */
          cancel: () => void;
      }
    | {
          kind: "refused";
          dir: string;
          /** Why the folder was judged unsafe to clear (it holds the music library, a drive root…). */
          reason: string;
          close: () => void;
      };

type Opener = (request: ClearTempRequest) => void;

let opener: Opener | null = null;

export const clearTempConfirmBridge = {
    setOpener(fn: Opener | null): void {
        opener = fn;
    },
    /**
     * Asks whether `fileCount` temporary files may be deleted. Resolves false when the user says no — and when
     * no UI is mounted to ask (e.g. headless runs): nothing is ever deleted without an answer.
     */
    confirm(dir: string, fileCount: number, bytes: number): Promise<boolean> {
        return new Promise((resolve) => {
            if (!opener) {
                resolve(false);
                return;
            }
            opener({ kind: "confirm", dir, fileCount, bytes, proceed: () => resolve(true), cancel: () => resolve(false) });
        });
    },
    /** Tells the user why nothing was deleted. Resolves once the dialog is closed (or at once with no UI). */
    refused(dir: string, reason: string): Promise<void> {
        return new Promise((resolve) => {
            if (!opener) {
                resolve();
                return;
            }
            opener({ kind: "refused", dir, reason, close: () => resolve() });
        });
    },
};
