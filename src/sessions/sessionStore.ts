import * as fs from "fs";
import * as path from "path";
import { EventEmitter } from "events";
import { DEFAULT_APP_DATA_DIR } from "#constants";
import { isPlainObject, loadDataFile, Parsed, refreshBackup, runMigrations } from "#utils/dataFile";
import { StoredSession, SessionsFile } from "./types";

export const SESSIONS_PATH = path.join(DEFAULT_APP_DATA_DIR, "sessions.json");

/** Bump when the data model changes, and add the `SESSIONS_MIGRATIONS[oldVersion]` step that upgrades a file. */
export const SESSIONS_FILE_VERSION = 1;

/** `[v]` upgrades a version-`v` file to `v + 1`. Runs once on load; the result is saved on the next write. */
const SESSIONS_MIGRATIONS: Record<number, (file: SessionsFile) => SessionsFile> = {};

const emptyFile = (): SessionsFile => ({ version: SESSIONS_FILE_VERSION, lastSessionId: null, sessions: [] });

const isStoredSession = (value: unknown): value is StoredSession =>
    isPlainObject(value) && typeof value.id === "string" && Array.isArray(value.tasks);

/** Validates the shape of a parsed `sessions.json`; `null` means it is not a sessions file at all. */
function parseSessionsFile(raw: unknown): Parsed<SessionsFile> {
    if (!isPlainObject(raw) || !Array.isArray(raw.sessions)) return null;

    // Files written before the version field existed are version 1.
    const version = typeof raw.version === "number" ? raw.version : 1;
    const sessions = raw.sessions.filter(isStoredSession);
    const dropped = raw.sessions.length - sessions.length;

    const file = {
        ...raw,
        version,
        lastSessionId: typeof raw.lastSessionId === "string" ? raw.lastSessionId : null,
        sessions,
    } as SessionsFile;
    // A file from a newer app keeps its version (and unknown keys); only older ones are upgraded.
    const value = runMigrations(file, version, SESSIONS_FILE_VERSION, SESSIONS_MIGRATIONS);
    if (version < SESSIONS_FILE_VERSION) value.version = SESSIONS_FILE_VERSION;

    if (version > SESSIONS_FILE_VERSION) {
        return {
            value,
            keepCopy: {
                suffix: `from-v${version}`,
                message: `Your sessions were saved by a newer version of the app (file format ${version}, this version understands ${SESSIONS_FILE_VERSION}). They are loaded as-is, but anything this version doesn't know about may be lost when it saves.`,
            },
        };
    }
    if (dropped > 0) {
        return {
            value,
            keepCopy: {
                suffix: `corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}`,
                message: `${dropped} ${dropped === 1 ? "entry" : "entries"} of your sessions file couldn't be read and ${dropped === 1 ? "was" : "were"} left out.`,
            },
        };
    }
    return { value };
}

export class SessionStore {
    private static instance: SessionStore;
    private cache: SessionsFile | null = null;
    private readonly emitter = new EventEmitter();
    /** The last load found a good file, so it is worth keeping as `.bak` before the first write. */
    private loadedHealthy = false;
    /** The file exists but couldn't be read: never write over content we haven't seen. */
    private readOnly = false;
    private backedUp = false;

    constructor(private readonly filePath: string = SESSIONS_PATH) {}

    static getInstance(): SessionStore {
        if (!SessionStore.instance) SessionStore.instance = new SessionStore();
        return SessionStore.instance;
    }

    private readFromDisk(): SessionsFile {
        const loaded = loadDataFile(this.filePath, "Your sessions file", parseSessionsFile);
        this.loadedHealthy = loaded.healthy;
        this.readOnly = loaded.readOnly;
        return loaded.value ?? emptyFile();
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
        if (this.readOnly) return;
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
            await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
            if (!this.backedUp) {
                // The file as it was at launch is the "last good copy" the next damaged load falls back on.
                this.backedUp = true;
                if (this.loadedHealthy) refreshBackup(this.filePath);
            }
            while (this.dirty) {
                this.dirty = false;
                const snapshot = this.cache;
                if (!snapshot) break;
                const tmp = this.filePath + ".tmp";
                // Compact JSON: smaller payload → faster stringify + write.
                await fs.promises.writeFile(tmp, JSON.stringify(snapshot), "utf-8");
                await fs.promises.rename(tmp, this.filePath);
            }
        } catch {
            // Persistence failures must not crash the UI; the next write retries.
            this.dirty = true;
        } finally {
            this.writing = false;
        }
    }

    /** Resolves once everything handed to the store so far is on disk. */
    async flush(): Promise<void> {
        if (this.dirty && !this.writing) void this.flushToDisk();
        while (this.dirty || this.writing) await new Promise((resolve) => setTimeout(resolve, 5));
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
