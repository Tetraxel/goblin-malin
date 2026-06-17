import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { FlowBase } from "#base/flow/flow-base";
import { FlowOrchestrator } from "#base/flow/flow-orchestrator";
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

    persistCurrent(snapshots: SessionTaskSnapshot[], flow?: FlowBase, orchestrator?: FlowOrchestrator): void {
        if (this.isLoading) return;

        if (this.persistTimer) clearTimeout(this.persistTimer);
        this.persistTimer = setTimeout(() => {
            this.persistTimer = null;
            this._doPersist(snapshots);
        }, this.DEBOUNCE_MS);
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
        orchestrator.setTasks([]);
        this.currentSessionId = null;
        this.emitter.emit("change");
    }

    duplicateSession(id: string, flow: FlowBase, orchestrator: FlowOrchestrator): void {
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
        };
        this.store.upsertSession(newSession);
        this.loadSession(newId, flow, orchestrator);
    }

    deleteSession(id: string, orchestrator?: FlowOrchestrator): void {
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
