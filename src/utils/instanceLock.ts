import * as fs from "fs";
import * as path from "path";
import { getAppDataDir } from "./appPaths";

/**
 * One running app per data folder. Each instance keeps the whole of `sessions.json` in memory and rewrites
 * it on every change, so a second one on the same folder would silently overwrite the first one's work.
 *
 * The lock is a file holding the owner's pid. It is released on exit; a file left by a crash is recognised
 * as stale (its pid is gone) and taken over. The `.pid.lock` name keeps it out of git in the test fixtures.
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

let held: string | null = null;

/** Takes the lock for this process. If another live instance holds it, says so instead of taking it. */
export function acquireInstanceLock(): LockResult {
    const lockPath = getLockPath();
    try {
        fs.mkdirSync(path.dirname(lockPath), { recursive: true });
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                fs.writeFileSync(lockPath, String(process.pid), { flag: "wx" });
                held = lockPath;
                return { acquired: true };
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
            }
            const owner = readOwner(lockPath);
            if (owner === process.pid) {
                held = lockPath;
                return { acquired: true };
            }
            if (owner !== null && isAlive(owner)) return { acquired: false, pid: owner, lockPath };
            // Stale (crashed owner) or unreadable: remove it and take it on the next pass.
            fs.rmSync(lockPath, { force: true });
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
    try {
        if (readOwner(lockPath) === process.pid) fs.rmSync(lockPath, { force: true });
    } catch {
        // Nothing useful to do: a leftover lock is recognised as stale next time.
    }
}
