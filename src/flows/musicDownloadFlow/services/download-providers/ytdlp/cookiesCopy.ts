import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { registerAgentCleanup } from "#base/agent/cleanup";

const COPY_PREFIX = "goblin-cookies-";
/** A copy this old belongs to a run that no longer exists (a crash, a kill): no download takes this long. */
const STALE_COPY_MS = 60 * 60_000;

export interface CookiesCopy {
    /** The copy to hand to yt-dlp. */
    path: string;
    /** Deletes the copy and the folder made for it. Safe to call more than once. */
    cleanup(): Promise<void>;
}

/**
 * Copies the user's `cookies.txt` for one yt-dlp run. yt-dlp writes its cookie jar back to the file it was given when
 * it exits, so parallel runs sharing one file would rewrite it at the same time (the last wins, a write can be
 * interleaved) and could replace or break the cookies the user exported. Each run gets a private copy in its own
 * temp folder instead (cookies are credentials: the folder is created owner-only), and the original is never touched.
 */
export async function copyCookiesForRun(source: string): Promise<CookiesCopy> {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), COPY_PREFIX));
    const copy = path.join(dir, "cookies.txt");
    try {
        await fs.promises.copyFile(source, copy);
    } catch (error) {
        await fs.promises.rm(dir, { recursive: true, force: true });
        throw error;
    }
    // The app closing, or a crash, in the middle of a run still removes the copy (a kill cannot: see the sweep below).
    const forget = registerAgentCleanup(() => fs.promises.rm(dir, { recursive: true, force: true }));
    return {
        path: copy,
        cleanup: async () => {
            forget();
            await fs.promises.rm(dir, { recursive: true, force: true });
        },
    };
}

/**
 * Removes the cookie copies a run that was killed (or lost power) left in the temp folder: they hold the user's
 * session, and nothing else would ever delete them. Only this app's own, and only old ones (another instance may be
 * running a download right now). Best effort: never throws.
 */
export async function sweepStaleCookieCopies(now = Date.now(), maxAgeMs = STALE_COPY_MS): Promise<number> {
    let removed = 0;
    try {
        const root = os.tmpdir();
        for (const name of await fs.promises.readdir(root)) {
            if (!name.startsWith(COPY_PREFIX)) continue;
            const dir = path.join(root, name);
            try {
                const stat = await fs.promises.stat(dir);
                if (!stat.isDirectory() || now - stat.mtimeMs < maxAgeMs) continue;
                await fs.promises.rm(dir, { recursive: true, force: true });
                removed++;
            } catch {
                // Not ours to remove, or already gone.
            }
        }
    } catch {
        // No temp folder to read: nothing to sweep.
    }
    return removed;
}
