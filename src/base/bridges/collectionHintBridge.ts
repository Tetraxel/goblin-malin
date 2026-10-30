export type CollectionHintRequest = {
    /** Name of the album/playlist task, for the dialog title. */
    label: string;
    /** User-facing explanation, from CollectionAccessError.hint. */
    hint: string;
    /** The user asked never to see this hint again. */
    muteForever: () => void;
};

type Opener = (request: CollectionHintRequest) => void;

let opener: Opener | null = null;

export const collectionHintBridge = {
    setOpener(fn: Opener | null): void {
        opener = fn;
    },
    /** No-op when no UI is mounted (e.g. headless runs). */
    request(req: CollectionHintRequest): void {
        opener?.(req);
    },
};
