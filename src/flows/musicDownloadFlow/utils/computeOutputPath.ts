import * as fs from "fs";
import * as path from "path";
import { CompiledMetadata } from "./compiledMetadata";

/**
 * The file name a track is saved under. `override` is a name the user chose for this track; it is
 * stored already cleaned (see `cleanOutputFilename`), so it is used as is.
 */
export function computeOutputFilename(compiled: CompiledMetadata, override?: string): string {
    if (override) return override;
    const artist = compiled.artists[0]?.name ?? "Unknown Artist";
    const title = compiled.trackName || "Unknown Title";
    return `${artist} - ${title}.flac`.replace(/[/\\:*?"<>|]/g, "_");
}

function samePath(a: string, b: string): boolean {
    const ra = path.resolve(a);
    const rb = path.resolve(b);
    return process.platform === "win32" ? ra.toLowerCase() === rb.toLowerCase() : ra === rb;
}

/**
 * Where a track would be written inside `outputDir`, adding " (2)", " (3)"… when the name is taken.
 * `ownPath` is the file this track already saved: it doesn't count as "taken" by itself.
 */
export function computeOutputPath(
    compiled: CompiledMetadata,
    outputDir: string,
    ownPath?: string,
    filenameOverride?: string
): string {
    const safe = computeOutputFilename(compiled, filenameOverride);
    const basePath = path.join(outputDir, safe);

    let dest = basePath;
    let counter = 2;
    while (fs.existsSync(dest) && !(ownPath && samePath(dest, ownPath))) {
        const ext = path.extname(basePath);
        const base = path.basename(basePath, ext);
        dest = path.join(outputDir, `${base} (${counter})${ext}`);
        counter++;
    }
    return dest;
}
