import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { sanitizeFileNamePart } from "./fileName";

// Extensions that mean "this pasted path ends in a file, not a folder" even when that file
// doesn't exist (yet) — so it can be dropped without touching a folder that merely has a dot.
const AUDIO_EXTENSIONS = new Set([
    ".flac",
    ".mp3",
    ".ogg",
    ".opus",
    ".wav",
    ".m4a",
    ".aac",
    ".wma",
    ".aiff",
    ".aif",
    ".alac",
]);

/**
 * The extension a file name gets when nothing says otherwise. The real one is set by the "Convert every download"
 * setting (or the download itself): it is never typed by the user, and the file name is edited without it.
 */
export const DEFAULT_OUTPUT_EXTENSION = "flac";

const QUOTE_PAIRS: Record<string, string> = { '"': '"', "'": "'", "“": "”", "‘": "’", "`": "`" };

function stripWrappingQuotes(value: string): string {
    let out = value.trim();
    while (out.length >= 2 && QUOTE_PAIRS[out[0]] === out[out.length - 1]) {
        out = out.slice(1, -1).trim();
    }
    return out;
}

function isExistingFile(p: string): boolean {
    try {
        return fs.statSync(p).isFile();
    } catch {
        return false;
    }
}

/**
 * Turns whatever the user pasted (from a file explorer, a terminal, a shell "Copy as path"…)
 * into a clean absolute folder path, or null when nothing usable is left.
 *
 * Handles surrounding quotes, `file://` links, `~`, forward slashes, trailing separators, extra
 * lines, and a trailing file name (an existing file, or anything ending in an audio extension).
 */
export function cleanOutputDir(raw: string): string | null {
    const firstLine = raw.split(/\r?\n/).find((line) => line.trim() !== "");
    if (!firstLine) return null;

    let value = stripWrappingQuotes(firstLine);
    if (!value) return null;

    if (/^file:\/\//i.test(value)) {
        try {
            value = fileURLToPath(value);
        } catch {
            return null;
        }
    }

    if (value === "~" || /^~[\\/]/.test(value)) value = path.join(os.homedir(), value.slice(1));

    // A POSIX shell escapes spaces as "\ " — on Windows a backslash is a separator, so leave it.
    if (process.platform !== "win32") value = value.replace(/\\ /g, " ");

    // A bare drive ("C:") would resolve against the current directory of that drive, not its root.
    if (/^[a-zA-Z]:$/.test(value)) value += path.sep;

    if (!path.isAbsolute(value)) return null;
    value = path.normalize(value);

    // Drop trailing separators, keeping a root ("C:\" or "/") intact.
    const root = path.parse(value).root;
    while (value.length > root.length && /[\\/]$/.test(value)) value = value.slice(0, -1);

    if (isExistingFile(value) || AUDIO_EXTENSIONS.has(path.extname(value).toLowerCase())) {
        value = path.dirname(value);
    }

    return value;
}

/**
 * Turns what the user typed or pasted into the name of the output file (with `extension`, the one every saved
 * track gets), or null when nothing usable is left. A pasted full path keeps only its last part,
 * quotes are removed, characters Windows forbids become `_`, and a trailing audio extension is
 * replaced rather than doubled.
 */
export function cleanOutputFilename(raw: string, extension: string = DEFAULT_OUTPUT_EXTENSION): string | null {
    const firstLine = raw.split(/\r?\n/).find((line) => line.trim() !== "");
    if (!firstLine) return null;

    const last = stripWrappingQuotes(firstLine).split(/[\\/]/).pop() ?? "";
    let stem = stripWrappingQuotes(last);
    const ext = path.extname(stem);
    if (AUDIO_EXTENSIONS.has(ext.toLowerCase())) stem = stem.slice(0, -ext.length);
    // ".flac" alone is a dotfile to `extname`, but it is an extension with no name in front of it.
    else if (AUDIO_EXTENSIONS.has(stem.toLowerCase())) stem = "";

    stem = sanitizeFileNamePart(stem);
    return stem ? `${stem}.${extension}` : null;
}

/** A saved track's file name without its `extension`, i.e. the part a user may change. */
export function stripOutputExtension(filename: string, extension: string = DEFAULT_OUTPUT_EXTENSION): string {
    const suffix = `.${extension}`;
    return filename.toLowerCase().endsWith(suffix) ? filename.slice(0, -suffix.length) : filename;
}

/**
 * `filename` with the audio extension it ends with (if any) replaced by `extension`. A name the user chose is stored
 * with the extension of the day it was typed; the format a track is saved in can change after that.
 */
export function withOutputExtension(filename: string, extension: string): string {
    const ext = path.extname(filename).toLowerCase();
    const stem = AUDIO_EXTENSIONS.has(ext) ? filename.slice(0, -ext.length) : filename;
    return `${stem}.${extension}`;
}

/** Same folder, regardless of case on Windows or a trailing separator. */
export function isSameDir(a: string, b: string): boolean {
    const norm = (p: string) => {
        const resolved = path.resolve(p);
        return process.platform === "win32" ? resolved.toLowerCase() : resolved;
    };
    return norm(a) === norm(b);
}
