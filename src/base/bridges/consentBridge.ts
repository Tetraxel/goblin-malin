export type ConsentRequest = {
    /** Registry key of the provider asking, e.g. "songlink". */
    providerKey: string;
    label: string;
    /** Provider brand color, used as the dialog accent. */
    color: string;
    title: string;
    message: string;
    /** The user allowed the provider: remember it and use it from now on. */
    allow: () => void;
    /** The user refused: remember it, never use the provider unless re-enabled in Settings. */
    deny: () => void;
    /** The dialog was dismissed (Esc) without an answer: don't use it now, ask again next launch. */
    dismiss: () => void;
};

type Opener = (request: ConsentRequest) => void;

let opener: Opener | null = null;

export const consentBridge = {
    setOpener(fn: Opener | null): void {
        opener = fn;
    },
    /** Returns false when no UI is mounted to show the dialog (e.g. headless runs). */
    request(req: ConsentRequest): boolean {
        if (!opener) return false;
        opener(req);
        return true;
    },
};
