import fs from "fs";
import path from "path";

/**
 * Every temp file the download providers create is named `<provider> <track id or title> <uuid>.<ext>`
 * (see `generateTempFilename` in tempFile.ts), and yt-dlp may leave `.part` / `.ytdl` / intermediate
 * siblings behind with the same stem. That UUID is how "clear temporary downloads" recognises the files
 * the app made itself — anything else in the folder is somebody's, and is never touched.
 */
const APP_TEMP_FILE = / [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[^\\/]+$/i;

export function isAppTempFile(name: string): boolean {
    return APP_TEMP_FILE.test(name);
}

/** A folder the temporary-download folder must never be, or contain (e.g. the music library). */
export type ProtectedPath = { label: string; path: string };

export type TempFile = { path: string; bytes: number };

export type TempClearPlan =
    | { ok: true; dir: string; files: TempFile[] }
    | { ok: false; dir: string; reason: string };

/** Absolute, symlink-free and (on Windows) lower-cased, so two spellings of one folder compare equal. */
function canonical(p: string): string {
    let resolved = path.resolve(p);
    try {
        resolved = fs.realpathSync(resolved);
    } catch {
        /* the folder does not exist (yet): the resolved path is all there is to compare */
    }
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/** True when `inner` is `outer` itself or lives somewhere below it. */
function isSameOrInside(inner: string, outer: string): boolean {
    const rel = path.relative(outer, inner);
    return rel === "" || (rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel));
}

/**
 * Decides what "Clear temporary downloads" may delete, without deleting anything.
 *
 * The temporary folder is a free-text setting, so it can be set to a folder that holds real files. The plan
 * therefore (1) refuses outright when the folder is a drive root, or is — or contains — any of
 * `protectedPaths` (the output folder, the home folder, the app's own data folder…), and (2) otherwise
 * lists only the files directly inside it that carry the app's temp-file signature. Sub-folders and foreign
 * files are left alone.
 */
export function planTempClear(tempDir: string, protectedPaths: ProtectedPath[]): TempClearPlan {
    const raw = tempDir.trim();
    const refuse = (reason: string): TempClearPlan => ({ ok: false, dir: raw, reason });

    if (!raw) return refuse("No temporary download folder is set.");
    if (!path.isAbsolute(raw)) return refuse("The temporary download folder is not an absolute path.");

    const dir = path.resolve(raw);
    if (path.parse(dir).root === dir) return refuse("It is a drive or filesystem root.");

    const canonicalDir = canonical(dir);
    for (const protectedPath of protectedPaths) {
        if (!protectedPath.path.trim()) continue;
        const canonicalProtected = canonical(protectedPath.path);
        if (isSameOrInside(canonicalProtected, canonicalDir)) {
            return refuse(
                canonicalProtected === canonicalDir
                    ? `It is also your ${protectedPath.label}.`
                    : `It contains your ${protectedPath.label}.`
            );
        }
    }

    if (!fs.existsSync(dir)) return { ok: true, dir, files: [] };

    try {
        const files: TempFile[] = [];
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (!entry.isFile() || !isAppTempFile(entry.name)) continue;
            const filePath = path.join(dir, entry.name);
            files.push({ path: filePath, bytes: fs.statSync(filePath).size });
        }
        return { ok: true, dir, files };
    } catch (error) {
        return refuse(`The folder cannot be read (${error instanceof Error ? error.message : String(error)}).`);
    }
}

/** Deletes the files of an approved plan. Returns how many went away and how many could not be deleted. */
export function deleteTempFiles(plan: Extract<TempClearPlan, { ok: true }>): {
    removed: number;
    failed: number;
    bytes: number;
} {
    let removed = 0;
    let failed = 0;
    let bytes = 0;
    for (const file of plan.files) {
        try {
            fs.rmSync(file.path, { force: true });
            removed++;
            bytes += file.bytes;
        } catch {
            failed++;
        }
    }
    return { removed, failed, bytes };
}
