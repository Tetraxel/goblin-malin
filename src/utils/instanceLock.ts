import * as fs from "fs";
import * as path from "path";
import { getAppDataDir } from "./appPaths";

/**
 * One running app per data folder. Each instance keeps the whole of `sessions.json` in memory and rewrites
 * it on every change, so a second one on the same folder would silently overwrite the first one's work.
 *
 * The lock is a file holding the owner's pid. It is released on exit; a file left by a crash is recognised
 * as stale (its pid is gone) and taken over. The `.pid.lock` name keeps it out of git in the test fixtures.
 *
 * A pid is reused quickly (after a reboot every low pid belongs to a system service), so a live pid alone does not
 * prove the owner is still this app: the owner also touches the file every minute, and a lock that has not been
 * touched for several minutes is stale whoever the pid belongs to now, unless the owner shows a sign of life within a
 * few seconds (a machine that slept: its heartbeat only runs again once it is awake). A version of the app from before
 * the heartbeat cannot be told from a reused pid after those minutes.
 */

export const LOCK_FILE_NAME = "app.pid.lock";

export const getLockPath = (): string => path.join(getAppDataDir(), LOCK_FILE_NAME);

export type LockResult = { acquired: true } | { acquired: false; pid: number | null; lockPath: string };

function isAlive(pid: number): boolean {
    try {
        process.kill(pid, 0); // signal 0 only checks that the process exists
        return true;
    } catch (error) {
        // EPERM: it exists but belongs to someone else.
        return (error as NodeJS.ErrnoException).code === "EPERM";
    }
}

function readOwner(lockPath: string): number | null {
    try {
        const pid = Number.parseInt(fs.readFileSync(lockPath, "utf-8").trim(), 10);
        return Number.isInteger(pid) && pid > 0 ? pid : null;
    } catch {
        return null;
    }
}

/** How often the owner proves it is alive (the file's modification time). */
export const HEARTBEAT_MS = 60_000;
/** A lock not touched for this long is a leftover, even when its pid is alive (reused by another program). */
export const STALE_AFTER_MS = 5 * HEARTBEAT_MS;

function ageMs(lockPath: string): number {
    try {
        return Date.now() - fs.statSync(lockPath).mtimeMs;
    } catch {
        return 0;
    }
}

/**
 * How long a lock that looks abandoned, but whose pid is alive, is watched for a sign of life before it is taken. An
 * owner whose machine was asleep (its timers did not run) touches the lock again as soon as it is awake, a moment
 * after the machine is; one that never does is a reused pid, or an app version that does not touch it.
 */
export const RESUME_GRACE_MS = 3000;
const GRACE_POLL_MS = 250;

function modifiedAt(lockPath: string): number | null {
    try {
        return fs.statSync(lockPath).mtimeMs;
    } catch {
        return null;
    }
}

/** Whether the owner touches the lock within `graceMs`. Blocks this process (nothing else is running yet at startup). */
function touchedWithin(lockPath: string, graceMs: number): boolean {
    const before = modifiedAt(lockPath);
    const deadline = Date.now() + graceMs;
    const pause = new Int32Array(new SharedArrayBuffer(4));
    while (Date.now() < deadline) {
        Atomics.wait(pause, 0, 0, GRACE_POLL_MS);
        const now = modifiedAt(lockPath);
        if (now === null) return false; // removed: the normal path deals with it
        if (now !== before) return true;
    }
    return false;
}

let held: string | null = null;
let heartbeat: NodeJS.Timeout | null = null;

function startHeartbeat(lockPath: string): void {
    stopHeartbeat();
    heartbeat = setInterval(() => {
        try {
            const now = new Date();
            fs.utimesSync(lockPath, now, now);
        } catch {
            /* the folder went away: nothing to keep alive */
        }
    }, HEARTBEAT_MS);
    // Never what keeps the process alive.
    heartbeat.unref();
}

function stopHeartbeat(): void {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
}

/**
 * Removes a lock that was judged stale, unless somebody else got there first. Two instances that start together on a
 * stale lock both decide to remove it; only one rename succeeds, and a lock taken from under a new owner (it is not
 * the one that was judged) is put back instead of being deleted.
 */
function removeStale(lockPath: string, judgedOwner: number | null): boolean {
    const aside = `${lockPath}.stale-${process.pid}`;
    try {
        fs.renameSync(lockPath, aside);
    } catch {
        return false; // gone already, or taken by the other instance: look again
    }
    if (readOwner(aside) !== judgedOwner) {
        // What was moved is a fresh lock, not the stale one: give it back.
        try {
            fs.renameSync(aside, lockPath);
        } catch {
            /* the other instance has made its own again: it keeps it */
        }
        return false;
    }
    fs.rmSync(aside, { force: true });
    return true;
}

/**
 * Creates the lock holding this pid, or throws `EEXIST` when there is one. The pid is written to a file of its own
 * first and then hard-linked to the lock's name (the link fails if the name exists): the lock never exists empty, so
 * another instance starting at the same moment can never read it as "unreadable, stale" and take it from under us.
 * On a file system without hard links (FAT, some network shares) it falls back to an exclusive create.
 */
function createLock(lockPath: string): void {
    const staging = `${lockPath}.${process.pid}.new`;
    try {
        fs.writeFileSync(staging, String(process.pid));
        try {
            fs.linkSync(staging, lockPath);
            return;
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code === "EEXIST") throw error;
            // No hard links here: the exclusive create below.
        }
    } finally {
        fs.rmSync(staging, { force: true });
    }
    fs.writeFileSync(lockPath, String(process.pid), { flag: "wx" });
}

/** Takes the lock for this process. If another live instance holds it, says so instead of taking it. */
export function acquireInstanceLock({ graceMs = RESUME_GRACE_MS }: { graceMs?: number } = {}): LockResult {
    const lockPath = getLockPath();
    try {
        fs.mkdirSync(path.dirname(lockPath), { recursive: true });
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                createLock(lockPath);
                held = lockPath;
                startHeartbeat(lockPath);
                return { acquired: true };
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
            }
            const owner = readOwner(lockPath);
            if (owner === process.pid) {
                held = lockPath;
                startHeartbeat(lockPath);
                return { acquired: true };
            }
            if (owner !== null && isAlive(owner)) {
                if (ageMs(lockPath) < STALE_AFTER_MS) return { acquired: false, pid: owner, lockPath };
                // Not touched for minutes: a reused pid, or an owner whose machine slept. Only the second one answers.
                if (touchedWithin(lockPath, graceMs)) return { acquired: false, pid: owner, lockPath };
            }
            // Stale (crashed owner, a pid now used by another program, or unreadable): remove it and take it on the
            // next pass.
            removeStale(lockPath, owner);
        }
        return { acquired: false, pid: readOwner(lockPath), lockPath };
    } catch {
        // A folder we can't write to is reported by the stores; the lock must never be the reason the app won't start.
        return { acquired: true };
    }
}

/** Gives the lock back. Safe to call more than once, and when the lock was never taken. */
export function releaseInstanceLock(): void {
    if (!held) return;
    const lockPath = held;
    held = null;
    stopHeartbeat();
    try {
        if (readOwner(lockPath) === process.pid) fs.rmSync(lockPath, { force: true });
    } catch {
        // Nothing useful to do: a leftover lock is recognised as stale next time.
    }
}
