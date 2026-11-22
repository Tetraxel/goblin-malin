import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { getBinDir } from "#utils/appPaths";
import { renameReplacing } from "#utils/dataFile";

/**
 * The user's YouTube cookies for yt-dlp: a `cookies.txt` kept in the app's `bin/` folder (`YtDlpService` copies it for
 * each run, see `cookiesCopy.ts`). YouTube answers "Sign in to confirm you're not a bot" to a client with no session,
 * and the cookies of a signed-in browser are what get past that. This file is what the user imports (a Netscape-format
 * export from a browser extension); it is checked before it replaces anything, because yt-dlp fails on a bad one with
 * an error the user cannot read.
 */

/** A cookies.txt is a few hundred lines; a file this big is not one. */
const MAX_COOKIES_BYTES = 5 * 1024 * 1024;
/** yt-dlp (like Python's cookie jar) refuses a file whose first line is not this one. */
const NETSCAPE_HEADER = "# Netscape HTTP Cookie File";
/** YouTube keeps its login in cookies of these domains. */
const YOUTUBE_DOMAIN = /(^|\.)youtube\.com$/i;
/** The cookies kept from an import: YouTube's, and Google's (the account YouTube signs in with). The rest is dropped. */
const KEPT_DOMAIN = /(^|\.)(youtube|google)\.com$/i;
/** After this many days YouTube has usually rotated the session the cookies came from. */
export const COOKIES_STALE_DAYS = 30;

export class CookiesImportError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "CookiesImportError";
    }
}

/** Where the imported file lives. */
export function cookiesFilePath(): string {
    return path.join(getBinDir(), "cookies.txt");
}

/** What a cookies.txt holds, counted (never its values: they are the user's session). */
export type CookiesSummary = {
    /** Cookies in the file. */
    cookies: number;
    /** Of those, the ones set for youtube.com. */
    youtube: number;
    /** Of the YouTube ones, how many carry an expiry date already past. */
    youtubeExpired: number;
    /** The file starts with the line yt-dlp insists on. */
    hasHeader: boolean;
};

/**
 * Reads a Netscape cookies.txt: one cookie per line, seven fields separated by TABs (domain, include-subdomains, path,
 * secure, expiry, name, value). A line starting with `#` is a comment, except `#HttpOnly_<domain>`, which is a cookie
 * the browser hides from scripts. Throws `CookiesImportError` when the text is not that, saying what it looks like.
 */
export function parseCookiesFile(text: string, now = Date.now()): CookiesSummary {
    const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    const lines = clean.split(/\r?\n/);
    const trimmed = clean.trimStart();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        throw new CookiesImportError(
            "This looks like a JSON export. Export again in the “Netscape” / cookies.txt format."
        );
    }

    let cookies = 0;
    let youtube = 0;
    let youtubeExpired = 0;
    let untabbed = 0;
    for (const raw of lines) {
        if (raw.trim() === "") continue;
        let line = raw;
        if (line.startsWith("#HttpOnly_")) line = line.slice("#HttpOnly_".length);
        else if (line.startsWith("#")) continue;
        const fields = line.split("\t");
        if (fields.length < 7) {
            untabbed++;
            continue;
        }
        cookies++;
        const domain = fields[0].trim();
        if (YOUTUBE_DOMAIN.test(domain)) {
            youtube++;
            const expiry = Number(fields[4]);
            // 0 is a session cookie (no expiry): it is valid for as long as the browser keeps it, which is "now".
            if (Number.isFinite(expiry) && expiry > 0 && expiry * 1000 < now) youtubeExpired++;
        }
    }
    if (cookies === 0) {
        throw new CookiesImportError(
            untabbed > 0
                ? "This is not a cookies.txt: its lines are not TAB-separated. Export it again with a cookies.txt extension, and do not edit it in a program that turns tabs into spaces."
                : "This file has no cookies in it."
        );
    }
    return { cookies, youtube, youtubeExpired, hasHeader: /^#( Netscape)? HTTP Cookie File/i.test(trimmed) };
}

/**
 * The path as a terminal pastes it when a file is dropped on it: in quotes (Windows Terminal), as `& 'path'`
 * (PowerShell), with escaped spaces (macOS, Linux), or as a `file://` address. Also `~`.
 */
export function cleanPastedPath(input: string, platform: NodeJS.Platform = process.platform): string {
    let text = input.trim();
    if (text.startsWith("& ")) text = text.slice(2).trim();
    if (
        text.length >= 2 &&
        ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))
    ) {
        text = text.slice(1, -1);
    }
    if (/^file:\/\//i.test(text)) {
        try {
            const url = new URL(text);
            // `file:///C:/x` → `/C:/x`: the leading slash is not part of a Windows path.
            text = decodeURIComponent(url.pathname).replace(/^\/([A-Za-z]:)/, "$1");
        } catch {
            /* not an address after all: used as typed */
        }
    } else if (platform !== "win32") {
        text = text.replace(/\\(.)/g, "$1");
    }
    if (text === "~" || text.startsWith("~/") || text.startsWith("~\\")) text = path.join(os.homedir(), text.slice(1));
    return text;
}

/**
 * The same cookies.txt with only the cookies yt-dlp needs for YouTube (`KEPT_DOMAIN`), under the header yt-dlp insists
 * on. Many exporters write every cookie of the browser (banks, mail…): they have no use here, and would otherwise sit
 * in the app's folder. Comments are dropped too; `#HttpOnly_` lines are cookies and follow the same rule.
 */
export function keepYouTubeCookies(text: string): { text: string; dropped: number } {
    const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    const kept: string[] = [];
    let dropped = 0;
    for (const raw of clean.split(/\r?\n/)) {
        if (raw.trim() === "") continue;
        const cookie = raw.startsWith("#HttpOnly_") ? raw.slice("#HttpOnly_".length) : raw.startsWith("#") ? null : raw;
        if (cookie === null) continue;
        const fields = cookie.split("\t");
        if (fields.length >= 7 && KEPT_DOMAIN.test(fields[0].trim())) kept.push(raw);
        else dropped++;
    }
    return { text: `${NETSCAPE_HEADER}\n${kept.join("\n")}\n`, dropped };
}

/** What importing a cookies.txt did. `dropped`: the cookies of other sites, left out of the copy. */
export type CookiesImport = CookiesSummary & { destination: string; dropped: number };

/**
 * Checks the file the user pointed at and, only if it is a usable cookies.txt for YouTube, puts a copy at
 * `cookiesFilePath()` (the original is left where it is, and may be deleted: it holds the user's session). The copy is
 * written beside its destination and renamed over it, so a failure never leaves the previous file half-replaced.
 * Throws `CookiesImportError` with a sentence the user can act on.
 */
export async function importCookiesFile(source: string, now = Date.now()): Promise<CookiesImport> {
    const from = cleanPastedPath(source);
    if (!from) throw new CookiesImportError("No file given.");

    let stat: fs.Stats;
    try {
        stat = await fs.promises.stat(from);
    } catch {
        throw new CookiesImportError(`No file at ${from}`);
    }
    if (!stat.isFile()) throw new CookiesImportError(`${from} is not a file.`);
    if (stat.size > MAX_COOKIES_BYTES) {
        throw new CookiesImportError("This file is too big to be a cookies.txt.");
    }

    const original = await fs.promises.readFile(from, "utf8");
    const summary = parseCookiesFile(original, now);
    if (summary.youtube === 0) {
        throw new CookiesImportError(
            "This file has no youtube.com cookies. Open youtube.com (signed in) in your browser, then export from there."
        );
    }
    if (summary.youtubeExpired === summary.youtube) {
        throw new CookiesImportError(
            "Every YouTube cookie in this file has expired. Sign in to YouTube again and export a fresh file."
        );
    }
    // Only YouTube's (and Google's) cookies are kept, under the first line yt-dlp insists on (many exports leave it out).
    const { text, dropped } = keepYouTubeCookies(original);

    const destination = cookiesFilePath();
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    const staging = `${destination}.importing-${process.pid}`;
    try {
        // Owner-only where the system has such a thing: these are credentials.
        await fs.promises.writeFile(staging, text, { mode: 0o600 });
        await renameReplacing(staging, destination);
    } finally {
        await fs.promises.rm(staging, { force: true });
    }
    return { ...summary, cookies: summary.cookies - dropped, hasHeader: true, destination, dropped };
}

/** The imported file, as the settings show it. */
export type CookiesState =
    | { status: "none" }
    | { status: "unreadable"; reason: string }
    | { status: "present"; summary: CookiesSummary; ageDays: number; modifiedAt: Date };

export async function readCookiesState(now = Date.now()): Promise<CookiesState> {
    const file = cookiesFilePath();
    let stat: fs.Stats;
    try {
        stat = await fs.promises.stat(file);
    } catch {
        return { status: "none" };
    }
    try {
        if (stat.size > MAX_COOKIES_BYTES) throw new CookiesImportError("the file is too big to be a cookies.txt");
        const summary = parseCookiesFile(await fs.promises.readFile(file, "utf8"), now);
        return {
            status: "present",
            summary,
            ageDays: Math.max(0, Math.floor((now - stat.mtimeMs) / 86_400_000)),
            modifiedAt: stat.mtime,
        };
    } catch (error) {
        return { status: "unreadable", reason: error instanceof Error ? error.message : String(error) };
    }
}

/** Deletes the imported file. False when there was none. */
export async function removeCookiesFile(): Promise<boolean> {
    try {
        await fs.promises.unlink(cookiesFilePath());
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
    }
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** One line for the settings: what is there, how old it is, and whether it is time to export it again. */
export function describeCookiesState(state: CookiesState): string {
    switch (state.status) {
        case "none":
            return "No cookies.txt imported (only needed when YouTube asks to sign in).";
        case "unreadable":
            return `The imported cookies.txt is unusable: ${state.reason}.`;
        case "present": {
            const { summary, ageDays } = state;
            const when = ageDays === 0 ? "today" : `${plural(ageDays, "day")} ago`;
            const base = `cookies.txt imported ${when}: ${plural(summary.youtube, "YouTube cookie")}`;
            if (summary.youtubeExpired > 0 && summary.youtubeExpired === summary.youtube) {
                return `${base}, all expired.`;
            }
            if (ageDays >= COOKIES_STALE_DAYS) {
                return `${base}. Old: YouTube may have signed it out.`;
            }
            return base;
        }
    }
}
