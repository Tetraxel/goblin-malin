import * as fs from "fs";
import { dataFileNoticeBridge } from "#base/bridges/dataFileNoticeBridge";

/**
 * Safe loading of the user's JSON data files (`sessions.json`, `settings.json`).
 *
 * Rule: a file we can't make sense of is never overwritten. It is moved aside (`<file>.corrupt-<date>`), the
 * user is told, and the last good copy (`<file>.bak`, refreshed once per launch) is restored when there is one.
 */

export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

type ReadResult =
    | { status: "missing" }
    | { status: "ok"; value: unknown }
    | { status: "corrupt"; reason: string }
    /** The file exists but could not be read (locked, permissions…): its content is unknown, not bad. */
    | { status: "unreadable"; reason: string };

function readJsonFile(filePath: string): ReadResult {
    let raw: string;
    try {
        raw = fs.readFileSync(filePath, "utf-8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "missing" };
        return { status: "unreadable", reason: error instanceof Error ? error.message : String(error) };
    }
    // Notepad and PowerShell 5's `Set-Content -Encoding UTF8` prepend a BOM, which JSON.parse rejects.
    const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    if (text.trim() === "") return { status: "corrupt", reason: "the file is empty" };
    try {
        return { status: "ok", value: JSON.parse(text) };
    } catch (error) {
        return { status: "corrupt", reason: error instanceof Error ? error.message : String(error) };
    }
}

export const backupPath = (filePath: string): string => `${filePath}.bak`;

const stamp = (): string => new Date().toISOString().replace(/[:.]/g, "-");

/** Moves a damaged file out of the way (copying it if it can't be moved). Returns where it went, or `null`. */
function quarantine(filePath: string): string | null {
    const dest = `${filePath}.corrupt-${stamp()}`;
    try {
        fs.renameSync(filePath, dest);
        return dest;
    } catch {
        try {
            fs.copyFileSync(filePath, dest);
            return dest;
        } catch {
            return null;
        }
    }
}

/** Keeps the current file as `<file>.bak`. Called once per launch, before the first write, on a healthy load. */
export function refreshBackup(filePath: string): void {
    try {
        fs.copyFileSync(filePath, backupPath(filePath));
    } catch {
        // A missing file or a failed copy only means there is no backup; never block the real write.
    }
}

/** What a store's `parse` hands back: the usable value, and optionally why a copy of the original was kept. */
export type Parsed<T> = {
    value: T;
    /** Keep a copy of the original file as `<file>.<suffix>` and show `message` (once: never overwrites). */
    keepCopy?: { suffix: string; message: string };
} | null;

export type Loaded<T> = {
    /** `null` when there is nothing usable (no file, or a damaged one with no backup): use the defaults. */
    value: T | null;
    /** True when `value` came from a good file on disk, so it is worth keeping as `.bak` before the first write. */
    healthy: boolean;
    /** True when the file couldn't be read at all: writing would overwrite content we never saw. */
    readOnly: boolean;
};

/**
 * Loads `filePath` as JSON and runs `parse` on it (return `null` for the wrong shape).
 * `what` names the file for the user, e.g. `Your sessions file`.
 */
export function loadDataFile<T>(filePath: string, what: string, parse: (raw: unknown) => Parsed<T>): Loaded<T> {
    const result = readJsonFile(filePath);

    if (result.status === "missing") return { value: null, healthy: false, readOnly: false };

    if (result.status === "unreadable") {
        dataFileNoticeBridge.report({
            title: `Can't read ${what.toLowerCase()}`,
            message: `${filePath}\n${result.reason}\n\nIt was left untouched, and changes made in this session won't be saved to it. Close whatever is using the file and restart.`,
        });
        return { value: null, healthy: false, readOnly: true };
    }

    let problem: string;
    if (result.status === "ok") {
        const parsed = parse(result.value);
        if (parsed) {
            if (parsed.keepCopy) {
                const dest = `${filePath}.${parsed.keepCopy.suffix}`;
                try {
                    fs.copyFileSync(filePath, dest, fs.constants.COPYFILE_EXCL);
                    dataFileNoticeBridge.report({
                        title: `${what} needs a look`,
                        message: `${parsed.keepCopy.message}\n\nA copy of the original was kept at:\n${dest}`,
                    });
                } catch (error) {
                    // Already kept on an earlier launch: stay quiet. Any other failure still deserves a word.
                    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
                        dataFileNoticeBridge.report({
                            title: `${what} needs a look`,
                            message: `${parsed.keepCopy.message}\n\nA copy of the original could not be kept.`,
                        });
                    }
                }
            }
            return { value: parsed.value, healthy: true, readOnly: false };
        }
        problem = "its content isn't what the app expects";
    } else {
        problem = result.reason;
    }

    const moved = quarantine(filePath);
    const keptAs = moved ? `The damaged file was kept at:\n${moved}` : "The damaged file could not be set aside.";

    const backup = readJsonFile(backupPath(filePath));
    const restored = backup.status === "ok" ? parse(backup.value) : null;
    if (restored) {
        dataFileNoticeBridge.report({
            title: `${what} was damaged`,
            message: `${filePath}\n(${problem})\n\n${keptAs}\n\nYour copy from the previous launch was restored, so recent changes may be missing.`,
        });
        return { value: restored.value, healthy: false, readOnly: false };
    }

    dataFileNoticeBridge.report({
        title: `${what} was damaged`,
        message: `${filePath}\n(${problem})\n\n${keptAs}\n\nThere was no backup to restore, so the app starts from scratch.`,
    });
    return { value: null, healthy: false, readOnly: false };
}

/** Applies `steps[v]` (v → v+1) for every version from `from` up to (not including) `to`. */
export function runMigrations<T>(data: T, from: number, to: number, steps: Record<number, (data: T) => T>): T {
    let current = data;
    for (let version = from; version < to; version++) {
        const step = steps[version];
        if (step) current = step(current);
    }
    return current;
}
