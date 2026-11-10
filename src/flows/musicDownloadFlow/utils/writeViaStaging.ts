import * as fs from "fs";
import * as path from "path";
import { renameReplacing } from "#utils/dataFile";

/**
 * Where `dest` is built before it replaces anything: next to it (so the final rename never crosses a drive),
 * under a name that keeps the extension (the tag writer is picked from it) and says what the file is.
 */
export function stagingPathFor(dest: string): string {
    const ext = path.extname(dest);
    return path.join(path.dirname(dest), `${path.basename(dest, ext)}.saving${ext}`);
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
