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
 * `ownPaths` are the files this track already saved, or is about to replace: they don't count as "taken".
 */
export function computeOutputPath(
    compiled: CompiledMetadata,
    outputDir: string,
    ownPaths: readonly (string | undefined)[] = [],
    filenameOverride?: string
): string {
    const safe = computeOutputFilename(compiled, filenameOverride);
    const basePath = path.join(outputDir, safe);
    const isOwn = (p: string) => ownPaths.some((own) => own !== undefined && samePath(p, own));

    let dest = basePath;
    let counter = 2;
    while (fs.existsSync(dest) && !isOwn(dest)) {
        const ext = path.extname(basePath);
        const base = path.basename(basePath, ext);
        dest = path.join(outputDir, `${base} (${counter})${ext}`);
        counter++;
    }
    return dest;
}
