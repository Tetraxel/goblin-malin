import * as fs from "fs";
import * as os from "os";
import * as path from "path";

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
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "goblin-cookies-"));
    const copy = path.join(dir, "cookies.txt");
    try {
        await fs.promises.copyFile(source, copy);
    } catch (error) {
        await fs.promises.rm(dir, { recursive: true, force: true });
        throw error;
    }
    return {
        path: copy,
        cleanup: () => fs.promises.rm(dir, { recursive: true, force: true }),
    };
}
