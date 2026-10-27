import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { TaskOrchestrator } from "#base/task/orchestrator";
import { TaskSnapshot } from "#base/task/task";
import { SettingsStore } from "#settings/settingsStore";
import { createTasksFromSnapshots } from "#flows/musicDownloadFlow/taskFactory";
import { SessionStore } from "./sessionStore";
import { globalLogger } from "#base/logger/logger";
import { MusicDownloadTaskAttributes } from "#flows/musicDownloadFlow/types";
import { StoredSession, SessionTaskSnapshot, ArchivedTaskSnapshot } from "./types";
import { deriveSessionName } from "./sessionSearch";

export class SessionManager {
    private static instance: SessionManager;
    private readonly emitter = new EventEmitter();
    private store = SessionStore.getInstance();

    private currentSessionId: string | null = null;
    private isLoading = false;

    private persistTimer: ReturnType<typeof setTimeout> | null = null;
    private pendingSnapshots: SessionTaskSnapshot[] | null = null;
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
        const session = this.store.getById(id);
        if (!session) return;

        // Flush any debounced write for the outgoing session first, so its latest
        // edits land on the right record before currentSessionId changes.
        this.flushPending();

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

    persistCurrent(snapshots: TaskSnapshot[]): void {
        if (this.isLoading) return;

        this.pendingSnapshots = snapshots as SessionTaskSnapshot[];
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

    /** Write any debounced snapshots immediately to the *current* session. */
    private flushPending(): void {
        if (!this.persistTimer && this.pendingSnapshots === null) return;
        if (this.persistTimer) {
            clearTimeout(this.persistTimer);
            this.persistTimer = null;
        }
        this.firstPendingAt = null;
        const snapshots = this.pendingSnapshots ?? [];
        this.pendingSnapshots = null;
        this._doPersist(snapshots);
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
     * Loads the task's own session first when it isn't the current one. Returns how many came back.
     */
    restoreArchived(sessionId: string, taskId: string): number {
        if (sessionId !== this.currentSessionId) this.loadSession(sessionId);
        if (this.currentSessionId !== sessionId) return 0;
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

        orchestrator.addTasks(createTasksFromSnapshots(restorable.map((e) => e.task)));
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

    getCurrentSessionId(): string | null {
        return this.currentSessionId;
    }

    onChanged(callback: () => void): () => void {
        this.emitter.on("change", callback);
        return () => this.emitter.off("change", callback);
    }
}
