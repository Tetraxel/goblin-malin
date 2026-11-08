export type DataFileNotice = {
    /** Short dialog title, e.g. `Sessions file was damaged`. */
    title: string;
    /** What happened to the user's file, where the damaged copy went, and what was restored. */
    message: string;
};

type Opener = (notice: DataFileNotice) => void;

let opener: Opener | null = null;

/**
 * Notices raised before the UI is mounted. The stores read their files while the app boots, well before
 * `AppInner` exists, so a notice can't be dropped just because nobody is listening yet.
 */
const pending: DataFileNotice[] = [];

export const dataFileNoticeBridge = {
    /** Installs the UI that shows notices, and hands it everything reported so far. `null` detaches it. */
    setOpener(fn: Opener | null): void {
        opener = fn;
        if (!fn) return;
        for (const notice of pending.splice(0)) fn(notice);
    },
    /**
     * Tells the user one of their data files (sessions, settings) was damaged, repaired or set aside.
     * Kept until a UI is attached, so headless runs simply never show it.
     */
    report(notice: DataFileNotice): void {
        if (opener) opener(notice);
        else pending.push(notice);
    },
    /** Forgets everything pending and detaches the UI. For tests. */
    reset(): void {
        opener = null;
        pending.length = 0;
    },
};
