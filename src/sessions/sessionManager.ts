import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { FlowBase } from "#base/flow/flow-base";
import { FlowOrchestrator } from "#base/flow/flow-orchestrator";
import { TaskSnapshot } from "#base/task/task";
import { SettingsStore } from "#settings/settingsStore";
import { SessionStore } from "./sessionStore";
import { StoredSession, SessionTaskSnapshot } from "./types";
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

    static getInstance(): SessionManager {
        if (!SessionManager.instance) SessionManager.instance = new SessionManager();
        return SessionManager.instance;
    }

    init(flow: FlowBase, orchestrator: FlowOrchestrator): void {
        const settings = SettingsStore.getInstance().getAppSettings();
        if (settings.general.reopenLastSession) {
            const last = this.store.getLastSession();
            if (last) {
                this.loadSession(last.id, flow, orchestrator);
                return;
            }
        }
        this.currentSessionId = null;
    }

    loadSession(id: string, flow: FlowBase, orchestrator: FlowOrchestrator): void {
        const session = this.store.getById(id);
        if (!session) return;

        // Flush any debounced write for the outgoing session first, so its latest
        // edits land on the right record before currentSessionId changes.
        this.flushPending();

        this.isLoading = true;
        try {
            if (flow.createTasksFromSnapshots) {
                const tasks = flow.createTasksFromSnapshots(session.tasks);
                orchestrator.setTasks(tasks);
            }
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
        if (this.persistTimer) clearTimeout(this.persistTimer);
        this.persistTimer = setTimeout(() => this.flushPending(), this.DEBOUNCE_MS);
    }

    /** Write any debounced snapshots immediately to the *current* session. */
    private flushPending(): void {
        if (!this.persistTimer && this.pendingSnapshots === null) return;
        if (this.persistTimer) {
            clearTimeout(this.persistTimer);
            this.persistTimer = null;
        }
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
                flowId: "music-downloader",
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

    newSession(orchestrator: FlowOrchestrator): void {
        this.flushPending();
        orchestrator.setTasks([]);
        this.currentSessionId = null;
        this.emitter.emit("change");
    }

    duplicateSession(id: string, flow: FlowBase, orchestrator: FlowOrchestrator): void {
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
        this.loadSession(newId, flow, orchestrator);
    }

    deleteSession(id: string, orchestrator?: FlowOrchestrator): void {
        // Drop a pending write for the current session before deleting it, otherwise the
        // debounced flush would re-create the record we just removed.
        if (this.currentSessionId === id) this.cancelPending();
        this.store.deleteSession(id);
        if (this.currentSessionId === id) {
            this.currentSessionId = null;
            orchestrator?.setTasks([]);
            this.emitter.emit("change");
        }
    }

    getCurrentSessionId(): string | null {
        return this.currentSessionId;
    }

    onChanged(callback: () => void): () => void {
        this.emitter.on("change", callback);
        return () => this.emitter.off("change", callback);
    }
}
