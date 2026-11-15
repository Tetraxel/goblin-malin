/**
 * What the agent changed, so "Undo Claude's last action" is possible.
 *
 * In memory, for this launch only. Each entry knows how to put back what it changed (`restore`) and the revision each
 * task it touched had right after the change: when a task's revision is not that any more, someone else (the user,
 * another turn) changed it since, and undoing would erase their work, so it is refused.
 *
 * An entry can cover several tasks (a batch is one action).
 */

export interface JournalEntry {
    id: number;
    at: Date;
    tool: string;
    /** One line for the chat ("set_metadata_override → Track X"). */
    label: string;
    /** Each task the change touched, with its revision right after the change. */
    checks: { taskId: string; revisionAfter: number }[];
    /** Puts the changed fields back. Only called when every revision still matches. */
    restore: () => void | Promise<void>;
}

export type UndoResult =
    | { done: true; entry: JournalEntry }
    | { done: false; reason: "nothing" | "changed" | "gone" | "busy"; entry?: JournalEntry; taskId?: string };

const MAX_ENTRIES = 200;

export class AgentJournal {
    private entries: JournalEntry[] = [];
    private nextId = 1;
    private listeners = new Set<() => void>();

    /**
     * @param revisionOf the task's revision now, or undefined when the task no longer exists.
     * @param isBusy whether the task cannot be changed right now (someone holds it, or it is being processed): the
     *   undo waits instead of putting back only part of an entry.
     */
    constructor(
        private readonly revisionOf: (taskId: string) => number | undefined,
        private readonly isBusy: (taskId: string) => boolean = () => false
    ) {}

    record(entry: Omit<JournalEntry, "id" | "at">): JournalEntry {
        const full: JournalEntry = { ...entry, id: this.nextId++, at: new Date() };
        this.entries.push(full);
        if (this.entries.length > MAX_ENTRIES) this.entries.shift();
        this.emit();
        return full;
    }

    /** Newest last. */
    list(): readonly JournalEntry[] {
        return this.entries;
    }

    last(): JournalEntry | undefined {
        return this.entries.at(-1);
    }

    /**
     * Reverts the newest entry. Refused (and the entry kept) when a task changed since or is busy right now; dropped
     * when a task is gone, since there is nothing left to put back. Every task is checked before anything is restored,
     * so an entry is undone whole or not at all.
     */
    async undoLast(): Promise<UndoResult> {
        const entry = this.entries.at(-1);
        if (!entry) return { done: false, reason: "nothing" };
        // A restore can yield to the event loop: a second undo started meanwhile would restore the same entry twice.
        if (this.undoing) return { done: false, reason: "busy", entry };
        for (const { taskId, revisionAfter } of entry.checks) {
            const revision = this.revisionOf(taskId);
            if (revision === undefined) {
                this.remove(entry);
                return { done: false, reason: "gone", entry, taskId };
            }
            if (revision !== revisionAfter) return { done: false, reason: "changed", entry, taskId };
        }
        const busy = entry.checks.find(({ taskId }) => this.isBusy(taskId));
        if (busy) return { done: false, reason: "busy", entry, taskId: busy.taskId };
        this.undoing = true;
        try {
            await entry.restore();
        } finally {
            this.undoing = false;
        }
        // That entry, not "the last one": a change recorded while the restore was waiting is newer and stays.
        this.remove(entry);
        return { done: true, entry };
    }

    /** Whether an undo is restoring an entry right now. */
    private undoing = false;

    private remove(entry: JournalEntry): void {
        const index = this.entries.indexOf(entry);
        if (index === -1) return;
        this.entries.splice(index, 1);
        this.emit();
    }

    clear(): void {
        if (this.entries.length === 0) return;
        this.entries = [];
        this.emit();
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private emit(): void {
        this.listeners.forEach((l) => l());
    }
}
