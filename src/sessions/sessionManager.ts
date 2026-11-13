import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import * as fs from "fs";
import { TaskOrchestrator } from "#base/task/orchestrator";
import { type Task, type TaskSnapshot } from "#base/task/task";
import { SettingsStore } from "#settings/settingsStore";
import { createTasksFromSnapshots } from "#flows/musicDownloadFlow/taskFactory";
import { SessionStore } from "./sessionStore";
import { globalLogger } from "#base/logger/logger";
import { type MusicDownloadTaskAttributes } from "#flows/musicDownloadFlow/types";
import { markMissingInAttributes, markMissingInSnapshot } from "#flows/musicDownloadFlow/utils/missingLocalFiles";
import { tempFileStem } from "#flows/musicDownloadFlow/utils/tempDownloads";
import type { TempUseGroup } from "#flows/musicDownloadFlow/utils/tempCleanup";
import { type StoredSession, type SessionTaskSnapshot, type ArchivedTaskSnapshot } from "./types";
import { deriveSessionName } from "./sessionSearch";

const fileIsGone = (filePath: string): boolean => !fs.existsSync(filePath);
/**
 * A temporary download that is no longer on disk. Only the app's own temp files are checked when a session
 * opens: a source relocated to a file on an unplugged or network drive is not "lost" for good, and marking it
 * would stick (only "Relocate" resets it).
 */
const tempFileIsGone = (filePath: string): boolean => tempFileStem(filePath) !== null && fileIsGone(filePath);

/** When a session was last in use: the latest of its explicit use stamp, its last edit and its creation. */
export function sessionLastUsedMs(session: StoredSession): number {
    const times = [session.lastUsedAt, session.updatedAt, session.createdAt].map((t) => (t ? Date.parse(t) : NaN));
    return Math.max(0, ...times.filter((t) => Number.isFinite(t)));
}

/** Task snapshots, or a function that reads them when they are needed (so a burst of changes builds them once). */
type SnapshotSource = SessionTaskSnapshot[] | (() => SessionTaskSnapshot[]);

export class SessionManager {
    private static instance: SessionManager;
    private readonly emitter = new EventEmitter();
    private store = SessionStore.getInstance();

    private currentSessionId: string | null = null;
    private isLoading = false;

    private persistTimer: ReturnType<typeof setTimeout> | null = null;
    /** What to save when the debounce fires: the snapshots, or a function reading them at that moment. */
    private pendingSnapshots: SnapshotSource | null = null;
    private readonly DEBOUNCE_MS = 800;
    // Cap how long a persist can be starved. The debounce resets on every change, so a
    // busy run (metadata + downloads notifying constantly) could otherwise never write
    // until it went quiet — losing durability and then landing one big write at the end.
    private readonly MAX_WAIT_MS = 5000;
    private firstPendingAt: number | null = null;

    static getInstance(): SessionManager {
        if (!SessionManager.instance) SessionManager.instance = new SessionManager();
        return SessionManager.instance;
    }

    init(): void {
        const settings = SettingsStore.getInstance().getAppSettings();
        if (settings.general.reopenLastSession) {
            const last = this.store.getLastSession();
            if (last) {
                this.loadSession(last.id);
                return;
            }
        }
        this.currentSessionId = null;
    }

    loadSession(id: string): void {
        if (!this.store.getById(id)) return;

        // Flush any debounced write for the outgoing session first, so its latest
        // edits land on the right record before currentSessionId changes.
        this.flushPending();
        // Read only now: when this is the session that is already open, the flush above just wrote its latest
        // edits, and building on the record read before it would put the old ones back.
        const stored = this.store.getById(id);
        if (!stored) return;

        // Opening a session is a use of it (its temporary downloads must outlive a clean-up for a while), and
        // any file that vanished while it was closed (cleaned up, deleted by hand) becomes "File not found"
        // here instead of a source that claims a file that is not there. `updatedAt` is left alone: it is
        // about edits and drives the list order.
        const session: StoredSession = {
            ...stored,
            tasks: stored.tasks.map((task) => markMissingInSnapshot(task, tempFileIsGone)),
            lastUsedAt: new Date().toISOString(),
        };
        this.store.upsertSession(session);

        this.isLoading = true;
        try {
            const tasks = createTasksFromSnapshots(session.tasks);
            TaskOrchestrator.getInstance().setTasks(tasks);
            this.currentSessionId = id;
            this.store.setLastSessionId(id);
            this.emitter.emit("change");
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * Saves the open session's tasks shortly after the last call. Pass a function to have the snapshots read when
     * the save actually happens: with thousands of tasks, building them on every change (many a second during a
     * run) costs far more than the save itself.
     */
    persistCurrent(snapshots: TaskSnapshot[] | (() => TaskSnapshot[])): void {
        if (this.isLoading) return;

        this.pendingSnapshots = snapshots as SnapshotSource;
        const now = Date.now();
        if (this.firstPendingAt === null) this.firstPendingAt = now;

        // Force a flush once the oldest pending change has waited MAX_WAIT_MS, even if
        // changes keep arriving; otherwise fall back to the trailing debounce.
        const waited = now - this.firstPendingAt;
        if (waited >= this.MAX_WAIT_MS) {
            this.flushPending();
            return;
        }
        if (this.persistTimer) clearTimeout(this.persistTimer);
        const delay = Math.min(this.DEBOUNCE_MS, this.MAX_WAIT_MS - waited);
        this.persistTimer = setTimeout(() => this.flushPending(), delay);
    }

    /** Writes the debounced changes now (the app is closing). The store's own write still has to be awaited. */
    flushNow(): void {
        this.flushPending();
        // The session open until now was in use until now, however long ago it was opened.
        const current = this.currentSessionId ? this.store.getById(this.currentSessionId) : undefined;
        if (current) this.store.upsertSession({ ...current, lastUsedAt: new Date().toISOString() });
    }

    /** Write any debounced snapshots immediately to the *current* session. */
    private flushPending(): void {
        if (!this.persistTimer && this.pendingSnapshots === null) return;
        if (this.persistTimer) {
            clearTimeout(this.persistTimer);
            this.persistTimer = null;
        }
        this.firstPendingAt = null;
        const source = this.pendingSnapshots;
        this.pendingSnapshots = null;
        this._doPersist(typeof source === "function" ? source() : (source ?? []));
    }

    /** Drop any debounced write without persisting (e.g. its session is being deleted). */
    private cancelPending(): void {
        if (this.persistTimer) {
            clearTimeout(this.persistTimer);
            this.persistTimer = null;
        }
        this.firstPendingAt = null;
        this.pendingSnapshots = null;
    }

    private _doPersist(snapshots: SessionTaskSnapshot[]): void {
        if (snapshots.length === 0 && this.currentSessionId === null) return;

        const now = new Date().toISOString();

        if (this.currentSessionId === null) {
            if (snapshots.length === 0) return;
            const id = randomUUID();
            const session: StoredSession = {
                id,
                name: deriveSessionName(snapshots),
                createdAt: now,
                updatedAt: now,
                lastUsedAt: now,
                tasks: snapshots,
            };
            this.store.upsertSession(session);
            this.currentSessionId = id;
        } else {
            const existing = this.store.getById(this.currentSessionId);
            if (!existing) return;
            this.store.upsertSession({ ...existing, tasks: snapshots, updatedAt: now });
        }

        this.store.setLastSessionId(this.currentSessionId);
        this.emitter.emit("change");
    }

    newSession(): void {
        this.flushPending();
        TaskOrchestrator.getInstance().setTasks([]);
        this.currentSessionId = null;
        this.emitter.emit("change");
    }

    duplicateSession(id: string): void {
        this.flushPending();
        const session = this.store.getById(id);
        if (!session) return;
        const newId = randomUUID();
        const now = new Date().toISOString();
        const newSession: StoredSession = {
            ...session,
            id: newId,
            name: `Copy of ${session.name}`,
            createdAt: now,
            updatedAt: now,
            renamed: false,
        };
        this.store.upsertSession(newSession);
        this.loadSession(newId);
    }

    deleteSession(id: string): void {
        // Drop a pending write for the current session before deleting it, otherwise the
        // debounced flush would re-create the record we just removed.
        if (this.currentSessionId === id) this.cancelPending();
        this.store.deleteSession(id);
        if (this.currentSessionId === id) {
            this.currentSessionId = null;
            TaskOrchestrator.getInstance().setTasks([]);
            this.emitter.emit("change");
        }
    }

    // ── Archive ──────────────────────────────────────────────────────────────
    // Archived tasks live in their session record (never in the orchestrator), so they
    // can't run, be selected, or show in the task list. The store is the single source
    // of truth: each operation writes it synchronously, and the debounced task persist
    // re-reads the session at flush time, so it can't clobber `archived`.

    /** Move idle tasks (and an album/playlist's tracks) out of the queue into the archive. Returns how many moved. */
    archiveTasks(ids: string[]): number {
        const orchestrator = TaskOrchestrator.getInstance();
        const all = orchestrator.getTasks();
        const idSet = new Set(ids);
        for (const task of all) {
            const attrs = task.getAttributes() as MusicDownloadTaskAttributes | undefined;
            if (idSet.has(task.getId()) && attrs?.kind === "collection")
                attrs.childTaskIds.forEach((id) => idSet.add(id));
        }

        const requested = all.filter((t) => idSet.has(t.getId()));
        const toArchive = requested.filter((t) => !t.running);
        if (toArchive.length < requested.length) {
            globalLogger.warn(`Archive: skipped ${requested.length - toArchive.length} running task(s)`);
        }
        if (toArchive.length === 0) return 0;

        this.flushPending();
        // A brand-new queue has no session record yet to hold the archive.
        if (this.currentSessionId === null) this._doPersist(all.map((t) => t.get() as SessionTaskSnapshot));
        const session = this.currentSessionId ? this.store.getById(this.currentSessionId) : undefined;
        if (!session) return 0;

        const archivedAt = new Date().toISOString();
        const entries: ArchivedTaskSnapshot[] = toArchive.map((t) => ({
            archivedAt,
            task: t.get() as SessionTaskSnapshot,
        }));
        const archivedIds = new Set(entries.map((e) => e.task.id));
        this.store.upsertSession({
            ...session,
            archived: [...entries, ...(session.archived ?? []).filter((e) => !archivedIds.has(e.task.id))],
            updatedAt: archivedAt,
        });
        orchestrator.removeTasks([...archivedIds]);
        this.emitter.emit("change");
        return entries.length;
    }

    /**
     * Put an archived task (plus an archived album/playlist's tracks) back in the queue.
     * Archives are per session, so only the current session's can be restored. Returns how many came back.
     */
    restoreArchived(sessionId: string, taskId: string): number {
        if (sessionId !== this.currentSessionId) return 0;
        this.flushPending();

        const session = this.store.getById(sessionId);
        const archived = session?.archived ?? [];
        const group = this.withArchivedChildren(archived, taskId);
        if (!session || group.length === 0) return 0;

        const orchestrator = TaskOrchestrator.getInstance();
        const live = new Set(orchestrator.getTasks().map((t) => t.getId()));
        const restorable = group.filter((e) => !live.has(e.task.id));
        if (restorable.length < group.length) {
            globalLogger.warn("Archive: some tasks are already in the queue and were left archived");
        }
        if (restorable.length === 0) return 0;

        orchestrator.addTasks(
            createTasksFromSnapshots(restorable.map((e) => markMissingInSnapshot(e.task, tempFileIsGone)))
        );
        const restoredIds = new Set(restorable.map((e) => e.task.id));
        this.store.upsertSession({
            ...session,
            archived: archived.filter((e) => !restoredIds.has(e.task.id)),
            updatedAt: new Date().toISOString(),
        });
        this.emitter.emit("change");
        return restorable.length;
    }

    /** Permanently drop an archived task (and an archived album/playlist's tracks). */
    deleteArchived(sessionId: string, taskId: string): void {
        const session = this.store.getById(sessionId);
        if (!session?.archived) return;
        const doomed = new Set(this.withArchivedChildren(session.archived, taskId).map((e) => e.task.id));
        this.store.upsertSession({ ...session, archived: session.archived.filter((e) => !doomed.has(e.task.id)) });
    }

    private withArchivedChildren(archived: ArchivedTaskSnapshot[], taskId: string): ArchivedTaskSnapshot[] {
        const root = archived.find((e) => e.task.id === taskId);
        if (!root) return [];
        const attrs = root.task.attributes as MusicDownloadTaskAttributes | undefined;
        const childIds = new Set(attrs?.kind === "collection" ? attrs.childTaskIds : []);
        return [root, ...archived.filter((e) => e !== root && childIds.has(e.task.id))];
    }

    // ── Temporary downloads ──────────────────────────────────────────────────

    /**
     * Who uses which temporary file, for clean-up: every stored session with the time it was last used, plus the
     * live queue (which can be ahead of its stored record, or never stored at all) as always in use.
     */
    getTempUseGroups(): TempUseGroup[] {
        // The stored record of the open session must not lag behind the queue.
        this.flushPending();
        const groups: TempUseGroup[] = this.store.getAll().map((session) => ({
            lastUsedMs: sessionLastUsedMs(session),
            live: session.id === this.currentSessionId,
            snapshots: [...session.tasks, ...(session.archived ?? []).map((entry) => entry.task)],
        }));
        groups.push({
            lastUsedMs: Date.now(),
            live: true,
            snapshots: TaskOrchestrator.getInstance()
                .getTasks()
                .map((task) => task.get()),
        });
        return groups;
    }

    /**
     * Temporary files were deleted (`stems` are the downloads the clean-up went through): every source that pointed at one —
     * in any stored session, archived tasks included, and in the live queue — now says "File not found", so
     * nothing keeps offering a file that is not there. Sessions are rewritten without touching `updatedAt` /
     * `lastUsedAt`. Resolves once that is on disk.
     */
    async markTempFilesDeleted(stems: ReadonlySet<string>): Promise<void> {
        if (stems.size === 0) return;
        this.flushPending();
        // `stems` are the downloads a clean-up went through. Whether a source's file is really gone is read from
        // the disk, not assumed: a leftover that could not be deleted must not leave the download looking
        // deleted, and a file that did go must not be left looking present.
        const isGone = (filePath: string): boolean => {
            const stem = tempFileStem(filePath);
            return stem !== null && stems.has(stem) && fileIsGone(filePath);
        };

        const sessionsChanged = this.store.updateSessions((session) => {
            const tasks = session.tasks.map((task) => markMissingInSnapshot(task, isGone));
            const archived = session.archived?.map((entry) => {
                const task = markMissingInSnapshot(entry.task, isGone);
                return task === entry.task ? entry : { ...entry, task };
            });
            const tasksChanged = tasks.some((task, i) => task !== session.tasks[i]);
            const archivedChanged = archived?.some((entry, i) => entry !== session.archived?.[i]) ?? false;
            if (!tasksChanged && !archivedChanged) return session;
            return { ...session, tasks, ...(archived ? { archived } : {}) };
        });

        let tasksChanged = 0;
        const liveTasks = TaskOrchestrator.getInstance().getTasks() as unknown as Task<MusicDownloadTaskAttributes>[];
        for (const task of liveTasks) {
            const attributes = task.getAttributes();
            if (!attributes) continue;
            const marked = markMissingInAttributes(attributes, isGone);
            if (marked === attributes) continue;
            task.updateAttributes(marked);
            tasksChanged++;
        }
        globalLogger.info(
            `Temporary downloads deleted: ${sessionsChanged} stored session(s) and ${tasksChanged} open task(s) updated`
        );
        await this.store.flush();
    }

    getCurrentSessionId(): string | null {
        return this.currentSessionId;
    }

    /** The stored record of the current session — undefined for a brand-new queue not yet persisted. */
    getCurrentSession(): StoredSession | undefined {
        return this.currentSessionId ? this.store.getById(this.currentSessionId) : undefined;
    }

    onChanged(callback: () => void): () => void {
        this.emitter.on("change", callback);
        return () => this.emitter.off("change", callback);
    }
}
