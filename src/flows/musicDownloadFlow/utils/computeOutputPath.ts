import * as fs from "fs";
import * as path from "path";
import { type CompiledMetadata } from "./compiledMetadata";

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

export function samePath(a: string, b: string): boolean {
    const ra = path.resolve(a);
    const rb = path.resolve(b);
    return process.platform === "win32" ? ra.toLowerCase() === rb.toLowerCase() : ra === rb;
}

/** Where a track is written inside `outputDir`: its file name, whether or not that name is already in use. */
export function computeOutputPath(compiled: CompiledMetadata, outputDir: string, filenameOverride?: string): string {
    return path.join(outputDir, computeOutputFilename(compiled, filenameOverride));
}

/**
 * Whether writing to `dest` would replace a file this track doesn't own. `ownPaths` are the files the track
 * already saved, or is about to replace: overwriting those is the point, so they don't count.
 */
export function isOutputPathTaken(dest: string, ownPaths: readonly (string | undefined)[] = []): boolean {
    if (!fs.existsSync(dest)) return false;
    return !ownPaths.some((own) => own !== undefined && samePath(dest, own));
}
