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
    /** The row the cursor starts on (e.g. the current choice). Default: the first. */
    initialIndex?: number;
    /**
     * When the content takes a while to get (a network lookup): the dialog opens at once with a loader, and shows
     * this body when it arrives. `null` or a failure closes it (answer `null`). `items` is only shown until then
     * (leave it empty); `loadingLabel` is the loader's text.
     */
    body?: Promise<ListDialogBody | null>;
    loadingLabel?: string;
};

export type ListAnswer = { index: number } | { none: true } | null;

/** One thing the user ticks in a matrix dialog (a row, or a column). */
export type MatrixItem = {
    key: string;
    label: string;
    /** A hex color for the label (a provider's brand color); the theme's text color when left out. */
    color?: string;
    /** How it starts. */
    checked: boolean;
    /** Lines shown under the grid while the cursor is on it (what it does, what it sends away). */
    detail?: string[];
    /** Columns only: a dim note beside it when no row has a `strong` cell in it (e.g. "searches any platform"). */
    note?: string;
};

/**
 * What joins a row to a column, drawn in their grid cell. A `strong` cell is drawn in the row's color while both are
 * ticked (and grey otherwise), and its row is named beside the column, in that color: the user sees at a glance which
 * rows feed which column. A weak one is plain text.
 */
export type MatrixCell = { row: string; column: string; mark: string; strong?: boolean };

/**
 * Two sets of things to tick on one screen, and how they depend on each other: the columns are listed first (each
 * with the rows it takes, in their colors), then a grid of the rows against the columns (e.g. metadata providers
 * against the download providers that use their links).
 */
export type MatrixDialog = {
    title: string;
    /** Text above the lists. */
    intro?: string;
    accent?: string;
    columns: { heading: string; items: MatrixItem[] };
    rows: { heading: string; items: MatrixItem[] };
    cells: MatrixCell[];
    /** Written before the rows a column takes (e.g. "links from"). */
    columnLinksLabel?: string;
    /** The label of the save hint ("Save" by default). */
    confirmLabel?: string;
};

/** Every item's value, in the order given; null when dismissed / nobody to ask. */
export type MatrixAnswer = { rows: boolean[]; columns: boolean[] } | null;

/** A one-line text field (e.g. the name of a group). */
export type InputDialog = {
    title: string;
    /** A line of text above the field. */
    message?: string;
    /** What the field holds when the dialog opens. */
    initialValue?: string;
    accent?: string;
    /** The most characters the field takes. */
    maxLength?: number;
};

/**
 * Shows a confirm dialog. May return a function that takes it off the screen again without answering (used when the
 * caller gives up on it: see `confirm`'s `signal`).
 */
type ConfirmOpener = (dialog: ConfirmDialog, resolve: (index: number | null) => void) => void | (() => void);
type ListOpener = (dialog: ListDialog, resolve: (answer: ListAnswer) => void) => void;
type InputOpener = (dialog: InputDialog, resolve: (value: string | null) => void) => void;
type MatrixOpener = (dialog: MatrixDialog, resolve: (answer: MatrixAnswer) => void) => void;

let confirmOpener: ConfirmOpener | null = null;
let listOpener: ListOpener | null = null;
let inputOpener: InputOpener | null = null;
let matrixOpener: MatrixOpener | null = null;

// One dialog is on screen at a time; the others wait here, in the order they were asked.
type Entry = {
    kind: "confirm" | "list" | "input" | "matrix";
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

/** The UI that shows one kind of dialog went away: the one on screen and the ones waiting can never be answered. */
function cancelKind(kind: Entry["kind"]): void {
    for (let i = queue.length - 1; i >= 0; i--) {
        if (queue[i].kind === kind) queue.splice(i, 1)[0].cancel();
    }
    if (current?.kind === kind) {
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
        else cancelKind("list");
    },
    setInputOpener(fn: InputOpener | null): void {
        inputOpener = fn;
        if (fn) pump();
        else cancelKind("input");
    },
    setMatrixOpener(fn: MatrixOpener | null): void {
        matrixOpener = fn;
        if (fn) pump();
        else cancelKind("matrix");
    },
    /**
     * The index of the button pressed, or null when dismissed / nobody to ask.
     *
     * With a `signal`: when it aborts (the question is no longer wanted, e.g. the user pressed Stop on the chat
     * turn that asked it) the dialog is taken off the screen, or out of the queue if it was not shown yet, and the
     * answer is null. A button pressed later cannot reach the caller.
     */
    confirm(dialog: ConfirmDialog, options: { signal?: AbortSignal } = {}): Promise<number | null> {
        const { signal } = options;
        return new Promise((resolve) => {
            if (!confirmOpener || signal?.aborted) return resolve(null);
            let settled = false;
            let release: () => void = () => undefined;
            let withdraw: (() => void) | void = undefined;
            const settle = (value: number | null) => {
                if (settled) return;
                settled = true;
                signal?.removeEventListener("abort", onAbort);
                resolve(value);
            };
            const entry: Entry = {
                kind: "confirm",
                open: (done) => {
                    if (!confirmOpener) return false;
                    release = done;
                    withdraw = confirmOpener(dialog, (index) => {
                        done();
                        settle(index);
                    });
                    return true;
                },
                cancel: () => settle(null),
            };
            function onAbort(): void {
                if (settled) return;
                const waiting = queue.indexOf(entry);
                if (waiting >= 0) queue.splice(waiting, 1);
                else {
                    withdraw?.();
                    release();
                }
                settle(null);
            }
            signal?.addEventListener("abort", onAbort, { once: true });
            queue.push(entry);
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
    /**
     * Every row's and column's value once the user saves; null when dismissed / nobody to ask. Shown one at a time with
     * the other dialogs, like `choose`.
     */
    matrix(dialog: MatrixDialog, options: { onUnanswerable?: () => void } = {}): Promise<MatrixAnswer> {
        return new Promise((resolve) => {
            // `onUnanswerable`: the null that follows is "nobody was there to ask" (no UI, or it went away), not a
            // person pressing Esc: the caller can tell the two apart.
            if (!matrixOpener) {
                options.onUnanswerable?.();
                return resolve(null);
            }
            queue.push({
                kind: "matrix",
                open: (done) => {
                    if (!matrixOpener) return false;
                    matrixOpener(dialog, (answer) => {
                        done();
                        resolve(answer);
                    });
                    return true;
                },
                cancel: () => {
                    options.onUnanswerable?.();
                    resolve(null);
                },
            });
            pump();
        });
    },
    /** The text typed (possibly empty), or null when dismissed / nobody to ask. */
    input(dialog: InputDialog): Promise<string | null> {
        return new Promise((resolve) => {
            if (!inputOpener) return resolve(null);
            queue.push({
                kind: "input",
                open: (done) => {
                    if (!inputOpener) return false;
                    inputOpener(dialog, (value) => {
                        done();
                        resolve(value);
                    });
                    return true;
                },
                cancel: () => resolve(null),
            });
            pump();
        });
    },
};
