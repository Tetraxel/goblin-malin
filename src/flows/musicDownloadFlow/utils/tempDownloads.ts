import fs from "fs";
import path from "path";

/**
 * Every temp file the download providers create is named `<provider> <track id or title> <uuid>.<ext>`
 * (see `generateTempFilename` in tempFile.ts), and yt-dlp may leave `.part` / `.ytdl` / intermediate
 * siblings behind with the same stem. That UUID is how "clear temporary downloads" recognises the files
 * the app made itself — anything else in the folder is somebody's, and is never touched.
 */
const APP_TEMP_FILE = / [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[^\\/]+$/i;
/** The same signature, capturing everything before the extension: the stem a download and its leftovers share. */
const APP_TEMP_STEM = /^(.* [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.[^\\/]+$/i;

export function isAppTempFile(name: string): boolean {
    return APP_TEMP_FILE.test(name);
}

/**
 * The stem (`<provider> <id> <uuid>`, lower-cased) of an app temp file, given its name or full path; `null`
 * for anything else. A download (`… <uuid>.flac`) and its leftovers (`… <uuid>.f251.webm.part`) share it, which
 * is how a session's `localFile.path` is matched to every file on disk that belongs to it.
 */
export function tempFileStem(nameOrPath: string): string | null {
    const name = nameOrPath.split(/[\\/]/).pop() ?? nameOrPath;
    const match = APP_TEMP_STEM.exec(name);
    return match ? match[1].toLowerCase() : null;
}

/** A folder the temporary-download folder must never be, or contain (e.g. the music library). */
export type ProtectedPath = { label: string; path: string };

export type TempFile = { path: string; bytes: number; mtimeMs: number };

/** One download and the leftovers sharing its stem: they are kept or deleted together. */
export type TempGroup = {
    stem: string;
    files: TempFile[];
    bytes: number;
    /** The newest modification time of the group's files: while it is recent, a download may still be writing. */
    mtimeMs: number;
};

export type TempFolderCheck = { ok: true; dir: string } | { ok: false; dir: string; reason: string };

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
 * Decides whether the temporary folder may be cleaned at all, without touching anything.
 *
 * The temporary folder is a free-text setting, so it can be set to a folder that holds real files. It is
 * therefore refused outright when it is a drive root, or is — or contains — any of `protectedPaths` (the
 * output folder, the home folder, the app's own data folder…).
 */
export function checkTempFolder(tempDir: string, protectedPaths: ProtectedPath[]): TempFolderCheck {
    const raw = tempDir.trim();
    const refuse = (reason: string): TempFolderCheck => ({ ok: false, dir: raw, reason });

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
    return { ok: true, dir };
}

/**
 * The app's own temp files directly inside `dir`, grouped by stem. Sub-folders and foreign files are left out.
 * Asynchronous: the folder can hold gigabytes in hundreds of files, and the UI must keep painting meanwhile.
 * A folder that does not exist (yet) has nothing in it.
 */
export async function scanTempGroups(dir: string): Promise<TempGroup[]> {
    let entries: fs.Dirent[];
    try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
    }

    const groups = new Map<string, TempGroup>();
    for (const entry of entries) {
        if (!entry.isFile()) continue;
        const stem = tempFileStem(entry.name);
        if (!stem) continue;
        const filePath = path.join(dir, entry.name);
        let stat: fs.Stats;
        try {
            stat = await fs.promises.stat(filePath);
        } catch {
            continue; // gone since the listing (a download finished or was cleaned up meanwhile)
        }
        const group = groups.get(stem) ?? { stem, files: [], bytes: 0, mtimeMs: 0 };
        group.files.push({ path: filePath, bytes: stat.size, mtimeMs: stat.mtimeMs });
        group.bytes += stat.size;
        group.mtimeMs = Math.max(group.mtimeMs, stat.mtimeMs);
        groups.set(stem, group);
    }
    return [...groups.values()];
}

export type DeleteTempResult = {
    /** Stems whose every file is gone: the sources that pointed at them are now broken links. */
    removedStems: Set<string>;
    removedFiles: number;
    failedFiles: number;
    bytes: number;
};

/** Deletes the groups' files one by one (so progress can be shown), reporting a stem only once all of it is gone. */
export async function deleteTempGroups(
    groups: TempGroup[],
    onProgress?: (done: number, total: number) => void
): Promise<DeleteTempResult> {
    const result: DeleteTempResult = { removedStems: new Set(), removedFiles: 0, failedFiles: 0, bytes: 0 };
    let done = 0;
    for (const group of groups) {
        let complete = true;
        for (const file of group.files) {
            try {
                await fs.promises.rm(file.path, { force: true });
                result.removedFiles++;
                result.bytes += file.bytes;
            } catch {
                result.failedFiles++;
                complete = false;
            }
        }
        if (complete) result.removedStems.add(group.stem);
        onProgress?.(++done, groups.length);
    }
    return result;
}
