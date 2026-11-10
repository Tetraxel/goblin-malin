import * as fs from "fs";
import * as path from "path";
import { moveFile } from "#utils/metadata";
import { runFfmpeg } from "./ffmpegRun";
import { OUTPUT_FORMATS, type OutputFormatKey } from "./outputFormat";

/** Re-encodes `src` into `dest` (whose extension should be the format's) with that format's encoder. */
export async function convertAudioFile(
    src: string,
    dest: string,
    format: OutputFormatKey,
    signal?: AbortSignal
): Promise<void> {
    // -vn: no cover-art "video" stream (not every target can hold one); first audio stream only.
    await runFfmpeg(["-i", src, "-vn", "-map", "0:a:0", ...OUTPUT_FORMATS[format].ffmpegArgs, dest], signal);
}

/**
 * Converts `src` into `format` and puts the result at `dest`. The encode happens next to `src` (the temporary
 * folder) under a name that shares its stem, so a crash leaves a leftover that "clear temporary downloads"
 * recognises and never a half-written file in the library; only a finished file is moved into place.
 */
export async function convertAudioInto(
    src: string,
    dest: string,
    format: OutputFormatKey,
    signal?: AbortSignal
): Promise<void> {
    const ext = OUTPUT_FORMATS[format].ext;
    const partial = path.join(path.dirname(src), `${path.basename(src, path.extname(src))}.converting.${ext}`);
    try {
        await convertAudioFile(src, partial, format, signal);
        await moveFile(partial, dest);
    } finally {
        await fs.promises.rm(partial, { force: true });
    }
}
