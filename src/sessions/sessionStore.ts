import * as fs from "fs";
import * as path from "path";
import { EventEmitter } from "events";
import { DEFAULT_APP_DATA_DIR } from "#constants";
import { StoredSession, SessionsFile } from "./types";

export const SESSIONS_PATH = path.join(DEFAULT_APP_DATA_DIR, "sessions.json");

const EMPTY_FILE: SessionsFile = { version: 1, lastSessionId: null, sessions: [] };

export class SessionStore {
    private static instance: SessionStore;
    private cache: SessionsFile | null = null;
    private readonly emitter = new EventEmitter();

    static getInstance(): SessionStore {
        if (!SessionStore.instance) SessionStore.instance = new SessionStore();
        return SessionStore.instance;
    }

    private readFromDisk(): SessionsFile {
        try {
            const raw = fs.readFileSync(SESSIONS_PATH, "utf-8");
            return JSON.parse(raw) as SessionsFile;
        } catch {
            return { ...EMPTY_FILE };
        }
    }

    private writing = false;
    private dirty = false;

    private writeToDisk(file: SessionsFile): void {
        // Update the in-memory cache + notify the UI synchronously so reads and the
        // sessions list stay instant; push the actual file write to a coalesced async
        // flush. The old synchronous `writeFileSync` of the whole file (every session,
        // pretty-printed) stalled the input thread on every debounced persist.
        this.cache = file;
        this.emitter.emit("change");
        this.dirty = true;
        void this.flushToDisk();
    }

    /**
     * Drain pending writes to disk without ever running two writes concurrently.
     * The `dirty`/`writing` pair coalesces a burst of edits into the minimum number
     * of atomic writes (temp file + rename), each off the main thread.
     */
    private async flushToDisk(): Promise<void> {
        if (this.writing) return; // an in-flight flush will pick up the latest `dirty`
        this.writing = true;
        try {
            await fs.promises.mkdir(path.dirname(SESSIONS_PATH), { recursive: true });
            while (this.dirty) {
                this.dirty = false;
                const snapshot = this.cache;
                if (!snapshot) break;
                const tmp = SESSIONS_PATH + ".tmp";
                // Compact JSON: smaller payload → faster stringify + write.
                await fs.promises.writeFile(tmp, JSON.stringify(snapshot), "utf-8");
                await fs.promises.rename(tmp, SESSIONS_PATH);
            }
        } catch {
            // Persistence failures must not crash the UI; the next write retries.
            this.dirty = true;
        } finally {
            this.writing = false;
        }
    }

    private getCached(): SessionsFile {
        if (!this.cache) this.cache = this.readFromDisk();
        return this.cache;
    }

    getAll(): StoredSession[] {
        return this.getCached().sessions;
    }

    getById(id: string): StoredSession | undefined {
        return this.getCached().sessions.find((s) => s.id === id);
    }

    getLastSession(): StoredSession | undefined {
        const { lastSessionId, sessions } = this.getCached();
        if (!lastSessionId) return undefined;
        return sessions.find((s) => s.id === lastSessionId);
    }

    upsertSession(session: StoredSession): void {
        const current = this.getCached();
        const idx = current.sessions.findIndex((s) => s.id === session.id);
        const sessions =
            idx >= 0 ? current.sessions.map((s, i) => (i === idx ? session : s)) : [session, ...current.sessions];
        this.writeToDisk({ ...current, sessions });
    }

    deleteSession(id: string): void {
        const current = this.getCached();
        const sessions = current.sessions.filter((s) => s.id !== id);
        const lastSessionId = current.lastSessionId === id ? null : current.lastSessionId;
        this.writeToDisk({ ...current, sessions, lastSessionId });
    }

    renameSession(id: string, name: string): void {
        const session = this.getById(id);
        if (!session) return;
        this.upsertSession({ ...session, name, renamed: true });
    }

    setLastSessionId(id: string | null): void {
        const current = this.getCached();
        this.writeToDisk({ ...current, lastSessionId: id });
    }

    onChanged(callback: () => void): () => void {
        this.emitter.on("change", callback);
        return () => this.emitter.off("change", callback);
    }
}
