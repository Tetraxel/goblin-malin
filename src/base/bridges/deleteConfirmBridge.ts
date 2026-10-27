export type DeleteConfirmRequest = {
    taskCount: number;
    /** Permanently remove the tasks. */
    apply: () => void;
    /** Move the tasks to the archive instead (the dialog's default choice). */
    archive: () => void;
};

type Opener = (request: DeleteConfirmRequest) => void;

let opener: Opener | null = null;

export const deleteConfirmBridge = {
    setOpener(fn: Opener | null): void {
        opener = fn;
    },
    request(req: DeleteConfirmRequest): void {
        opener?.(req);
    },
};
