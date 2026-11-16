import { randomBytes } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { renameReplacing } from "#utils/dataFile";

/**
 * Where `dest` is built before it replaces anything: next to it (so the final rename never crosses a drive),
 * under a name that keeps the extension (the tag writer is picked from it) and says what the file is. The name is
 * different on every call: two saves to one destination must not share (and delete) each other's staging file, and a
 * file the user happens to have under a fixed staging name is never overwritten.
 */
export function stagingPathFor(dest: string): string {
    const ext = path.extname(dest);
    return path.join(path.dirname(dest), `${path.basename(dest, ext)}.saving-${randomBytes(4).toString("hex")}${ext}`);
}

/**
 * Makes the file at `dest` without ever leaving it half-written: `build` writes the finished file (copy, convert,
 * tag…) at a staging path, and only then is it renamed over `dest`. If `build` or the rename fails, the staging
 * file is removed and whatever was at `dest` is untouched, which matters when the user agreed to replace it.
 */
export async function writeViaStaging(dest: string, build: (stagingPath: string) => Promise<void>): Promise<void> {
    const staging = stagingPathFor(dest);
    try {
        await build(staging);
        await renameReplacing(staging, dest);
    } finally {
        await fs.promises.rm(staging, { force: true });
    }
}

// Whoever waits for a destination, per path. Windows and macOS file systems ignore case, so "A.flac" and "a.flac" are
// one destination there.
const destinationLocks = new Map<string, Promise<void>>();
const caseInsensitive = process.platform === "win32" || process.platform === "darwin";

/**
 * Waits until no other save is working on `dest`, and returns what releases it. Held from the "is the name taken?"
 * check to the rename, so a second track saved to the same name asks the user about the file the first one made (it
 * would otherwise pass the check at the same moment, before that file exists). Always release, in a `finally`.
 */
export async function acquireDestinationLock(dest: string): Promise<() => void> {
    const resolved = path.resolve(dest);
    const key = caseInsensitive ? resolved.toLowerCase() : resolved;
    const previous = destinationLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((resolve) => (release = resolve));
    const tail = previous.then(() => mine);
    destinationLocks.set(key, tail);
    await previous;
    return () => {
        release();
        if (destinationLocks.get(key) === tail) destinationLocks.delete(key);
    };
}
