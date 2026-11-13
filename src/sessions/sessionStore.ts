import * as fs from "fs";
import * as path from "path";
import { EventEmitter } from "events";
import { DEFAULT_APP_DATA_DIR } from "#constants";
import { globalLogger } from "#base/logger/logger";
import { dataFileNoticeBridge } from "#base/bridges/dataFileNoticeBridge";
import {
    isPlainObject,
    loadDataFile,
    type Parsed,
    refreshBackup,
    renameReplacing,
    runMigrations,
} from "#utils/dataFile";
import { type StoredSession, type SessionsFile } from "./types";
import { serializeSessionsFile } from "./serialize";

export const SESSIONS_PATH = path.join(DEFAULT_APP_DATA_DIR, "sessions.json");

/** Bump when the data model changes, and add the `SESSIONS_MIGRATIONS[oldVersion]` step that upgrades a file. */
export const SESSIONS_FILE_VERSION = 1;

/** `[v]` upgrades a version-`v` file to `v + 1`. Runs once on load; the result is saved on the next write. */
const SESSIONS_MIGRATIONS: Record<number, (file: SessionsFile) => SessionsFile> = {};

/** First retry after a failed write; doubles each time up to the cap. */
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30_000;
/** How long `flush()` keeps retrying a failing write before giving up (it must fit inside the close timeout). */
const FLUSH_TIMEOUT_MS = 4000;
const FLUSH_RETRY_MS = 150;
/**
 * Failed writes in a row before the user is told. A file held for a moment by another program is already
 * retried inside each write; this keeps one unlucky moment from becoming a dialog. The third failure comes
 * at least ~1.5 s after the first (sooner retries happen when new changes arrive meanwhile).
 */
const NOTIFY_AFTER_FAILURES = 3;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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

    constructor(
        private readonly filePath: string = SESSIONS_PATH,
        /** Waits between quick retries of a briefly locked file inside one write (tests shorten them). */
        private readonly renameRetryDelaysMs?: readonly number[]
    ) {}

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
    /** Consecutive failed writes; the user is told once per streak (see NOTIFY_AFTER_FAILURES). */
    private failures = 0;
    private retryTimer: NodeJS.Timeout | null = null;
    private tmpCounter = 0;

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
     * of atomic writes (temp file + rename). Only the file write is asynchronous; the text is built on this thread,
     * but from per-object caches (see serialize.ts), so it costs what changed, not the size of the file.
     */
    private async flushToDisk(): Promise<void> {
        if (this.writing) return; // an in-flight flush will pick up the latest `dirty`
        this.writing = true;
        let tmp: string | null = null;
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
                // A name of its own, so two writers never share (and corrupt) one temp file.
                tmp = `${this.filePath}.${process.pid}.${this.tmpCounter++}.tmp`;
                // Compact JSON, and only what changed is stringified (see serialize.ts).
                await fs.promises.writeFile(tmp, serializeSessionsFile(snapshot), "utf-8");
                await renameReplacing(tmp, this.filePath, this.renameRetryDelaysMs);
                tmp = null;
            }
            if (this.failures > 0)
                globalLogger.info(`Sessions file saved again after ${this.failures} failed attempt(s)`);
            this.failures = 0;
        } catch (error) {
            // Persistence failures must not crash the UI: keep the data in memory and retry.
            this.dirty = true;
            this.onWriteFailed(error);
        } finally {
            if (tmp) await fs.promises.rm(tmp, { force: true }).catch(() => undefined);
            this.writing = false;
        }
    }

    /** Logs the failure, tells the user once a streak lasts, and schedules a retry with a growing delay. */
    private onWriteFailed(error: unknown): void {
        this.failures++;
        const reason = error instanceof Error ? error.message : String(error);
        globalLogger.warn(`Could not save the sessions file (attempt ${this.failures}): ${reason}`);
        if (this.failures === NOTIFY_AFTER_FAILURES) {
            dataFileNoticeBridge.report({
                title: "Your sessions couldn't be saved",
                message: `Writing ${this.filePath} failed (${reason}). Your work is kept in memory and saving is retried, but if the app closes before it succeeds, the latest changes are lost. Check that the disk isn't full and that no other program (antivirus, sync) is locking the file.`,
            });
        }
        if (this.retryTimer) return;
        const delay = Math.min(RETRY_BASE_MS * 2 ** (this.failures - 1), RETRY_MAX_MS);
        this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            if (this.dirty) void this.flushToDisk();
        }, delay);
        this.retryTimer.unref();
    }

    /**
     * Resolves once everything handed to the store so far is on disk, retrying a failing write for a few
     * seconds. Returns `false` when it gave up: the latest changes are then only in memory.
     */
    async flush(timeoutMs: number = FLUSH_TIMEOUT_MS): Promise<boolean> {
        const deadline = Date.now() + timeoutMs;
        let delay = FLUSH_RETRY_MS;
        while (this.dirty || this.writing) {
            if (this.writing) {
                await sleep(5);
                continue;
            }
            await this.flushToDisk();
            if (!this.dirty) break;
            // The write failed: wait a little and try again, until the deadline.
            if (Date.now() + delay > deadline) return false;
            await sleep(delay);
            delay *= 2;
        }
        return true;
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

    /**
     * Rewrites sessions in a single write. `fn` returns the very same object for a session it leaves alone.
     * Returns how many sessions changed.
     */
    updateSessions(fn: (session: StoredSession) => StoredSession): number {
        const current = this.getCached();
        let changed = 0;
        const sessions = current.sessions.map((session) => {
            const next = fn(session);
            if (next !== session) changed++;
            return next;
        });
        if (changed > 0) this.writeToDisk({ ...current, sessions });
        return changed;
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
        // Every save of the open session calls this with the id it already has: nothing to write, and no reason to
        // wake every listener (the sessions list, the archive, the toolbar) for it.
        if (current.lastSessionId === id) return;
        this.writeToDisk({ ...current, lastSessionId: id });
    }

    onChanged(callback: () => void): () => void {
        this.emitter.on("change", callback);
        return () => this.emitter.off("change", callback);
    }
}
