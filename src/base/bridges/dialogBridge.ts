/**
 * Lets plain-TypeScript code (task actions, flows) ask the user something and wait for the answer, without
 * knowing anything about React: the app mounts the openers, the caller just awaits.
 *
 * Both calls resolve `null` when the user dismisses the dialog (Esc) — and when no UI is mounted to ask (headless
 * runs, or the UI went away while the dialog was waiting), so "nobody said yes" never reads as consent.
 *
 * Dialogs asked through here are shown one at a time, in the order asked: a notice never opens over a list the user
 * is choosing from.
 */

/** A button's look, resolved to a theme color by the UI. */
export type DialogTone = "primary" | "danger" | "muted" | "success";

export type ConfirmDialog = {
    title: string;
    message: string;
    /** Buttons, left to right. The first is where the cursor starts: make it the safe one. */
    choices: { label: string; tone: DialogTone }[];
    /** A hex color for the frame (e.g. a provider's brand color). Defaults to the theme's primary action color. */
    accent?: string;
};

/** A page about an item. `openUrl` is what gets opened: the desktop app's address when there is one (see `toAppUri`). */
export type DialogLink = {
    label: string;
    url: string;
    openUrl: string;
    /** The service's key in the provider display registry, when known: the label is shown in its color. */
    providerKey?: string;
};

export type ListItem = {
    label: string;
    /** Lines under the label (evidence, details), shown dimmed. */
    detail?: string[];
    /** A web page about the item: `O` opens it, and so does a click on the line that shows it. */
    url?: string;
    /** Other pages about it (up to 6), shown under the item; a click opens one. */
    links?: DialogLink[];
};

/** What a list dialog shows below its title. */
export type ListDialogBody = {
    /** Text above the list. */
    intro?: string;
    items: ListItem[];
    /** An extra last row ("None of these"). Choosing it answers `{ none: true }`. */
    noneLabel?: string;
};

export type ListDialog = ListDialogBody & {
    title: string;
    accent?: string;
    /**
     * When the content takes a while to get (a network lookup): the dialog opens at once with a loader, and shows
     * this body when it arrives. `null` or a failure closes it (answer `null`). `items` is only shown until then
     * (leave it empty); `loadingLabel` is the loader's text.
     */
    body?: Promise<ListDialogBody | null>;
    loadingLabel?: string;
};

export type ListAnswer = { index: number } | { none: true } | null;

type ConfirmOpener = (dialog: ConfirmDialog, resolve: (index: number | null) => void) => void;
type ListOpener = (dialog: ListDialog, resolve: (answer: ListAnswer) => void) => void;

let confirmOpener: ConfirmOpener | null = null;
let listOpener: ListOpener | null = null;

// One dialog is on screen at a time; the others wait here, in the order they were asked.
type Entry = {
    kind: "confirm" | "list";
    /** Shows the dialog; `done` must be called once it is answered. False when there is no UI to show it. */
    open: (done: () => void) => boolean;
    /** Nobody will answer: resolves the caller's promise with null. */
    cancel: () => void;
};
const queue: Entry[] = [];
let current: Entry | null = null;

function pump(): void {
    if (current) return;
    const next = queue.shift();
    if (!next) return;
    current = next;
    const done = () => {
        if (current !== next) return;
        current = null;
        // The next one opens a tick later: the UI is still clearing the one just answered, and must not wipe the next.
        setTimeout(pump, 0);
    };
    if (!next.open(done)) {
        current = null;
        next.cancel();
        pump();
    }
}

/** The UI that shows list dialogs went away: the one on screen and the ones waiting can never be answered. */
function cancelLists(): void {
    for (let i = queue.length - 1; i >= 0; i--) {
        if (queue[i].kind === "list") queue.splice(i, 1)[0].cancel();
    }
    if (current?.kind === "list") {
        const gone = current;
        current = null;
        gone.cancel();
        setTimeout(pump, 0);
    }
}

export const dialogBridge = {
    // Not cancelled when the opener is swapped out: the app registers a new one when its theme changes, and the
    // dialog on screen is still there to be answered.
    setConfirmOpener(fn: ConfirmOpener | null): void {
        confirmOpener = fn;
        if (fn) pump();
    },
    setListOpener(fn: ListOpener | null): void {
        listOpener = fn;
        if (fn) pump();
        else cancelLists();
    },
    /** The index of the button pressed, or null when dismissed / nobody to ask. */
    confirm(dialog: ConfirmDialog): Promise<number | null> {
        return new Promise((resolve) => {
            if (!confirmOpener) return resolve(null);
            queue.push({
                kind: "confirm",
                open: (done) => {
                    if (!confirmOpener) return false;
                    confirmOpener(dialog, (index) => {
                        done();
                        resolve(index);
                    });
                    return true;
                },
                cancel: () => resolve(null),
            });
            pump();
        });
    },
    /** The row picked, "none" for the extra last row, or null when dismissed / nobody to ask. */
    choose(dialog: ListDialog): Promise<ListAnswer> {
        return new Promise((resolve) => {
            if (!listOpener) return resolve(null);
            queue.push({
                kind: "list",
                open: (done) => {
                    if (!listOpener) return false;
                    listOpener(dialog, (answer) => {
                        done();
                        resolve(answer);
                    });
                    return true;
                },
                cancel: () => resolve(null),
            });
            pump();
        });
    },
};
