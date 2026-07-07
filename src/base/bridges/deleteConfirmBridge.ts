export type DeleteConfirmRequest = {
    taskCount: number;
    apply: () => void;
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
