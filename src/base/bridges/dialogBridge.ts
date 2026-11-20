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
    /**
     * Makes the list a checklist (one value per item: ticked or not). A key toggles the row under the cursor and
     * Enter answers `{ checked }` with every row's value. Set by `dialogBridge.checklist`, which also leaves out
     * `noneLabel` and `body`.
     */
    checked?: boolean[];
    /** The label of the Enter hint ("Choose" by default). */
    confirmLabel?: string;
};

export type ListAnswer = { index: number } | { none: true } | null;

/** What the list dialog answers: a row (see `ListAnswer`), or every row's value for a checklist. */
export type ListDialogAnswer = ListAnswer | { checked: boolean[] };

/** A list the user ticks rows of (e.g. the providers to use). */
export type ChecklistDialog = {
    title: string;
    /** Text above the list. */
    intro?: string;
    /** The rows; `checked` is how each starts. */
    items: (ListItem & { checked: boolean })[];
    accent?: string;
    /** The label of the Enter hint (e.g. "Save"). */
    confirmLabel?: string;
};

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
type ListOpener = (dialog: ListDialog, resolve: (answer: ListDialogAnswer) => void) => void;
type InputOpener = (dialog: InputDialog, resolve: (value: string | null) => void) => void;

let confirmOpener: ConfirmOpener | null = null;
let listOpener: ListOpener | null = null;
let inputOpener: InputOpener | null = null;

// One dialog is on screen at a time; the others wait here, in the order they were asked.
type Entry = {
    kind: "confirm" | "list" | "input";
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
                        resolve(answer && "checked" in answer ? null : answer);
                    });
                    return true;
                },
                cancel: () => resolve(null),
            });
            pump();
        });
    },
    /**
     * Every row's value once the user confirms (Enter), in the order of `items`; null when dismissed / nobody to ask.
     * Shown one at a time with the other dialogs, like `choose`.
     */
    checklist(dialog: ChecklistDialog): Promise<boolean[] | null> {
        const list: ListDialog = {
            title: dialog.title,
            intro: dialog.intro,
            accent: dialog.accent,
            confirmLabel: dialog.confirmLabel,
            items: dialog.items.map(({ checked: _checked, ...item }) => item),
            checked: dialog.items.map((item) => item.checked),
        };
        return new Promise((resolve) => {
            if (!listOpener) return resolve(null);
            queue.push({
                kind: "list",
                open: (done) => {
                    if (!listOpener) return false;
                    listOpener(list, (answer) => {
                        done();
                        resolve(answer && "checked" in answer ? answer.checked : null);
                    });
                    return true;
                },
                cancel: () => resolve(null),
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
