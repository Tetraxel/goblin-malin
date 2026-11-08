import * as path from "path";
import { SlskFile } from "slsk-client";

// Files bigger than this are less interesting — likely a whole album/rip
// rather than a single track.
const MAX_PREFERRED_SIZE_MB = 50;

// Only the top-ranked candidates are attempted, in order, before giving up.
export const MAX_DOWNLOAD_ATTEMPTS = 5;

// How many results of one search are listed as rows unless the "results shown" setting says otherwise.
export const DEFAULT_RESULTS_LIMIT = 10;
// Results kept beyond the listed ones, for the "show more" row. Bounded because they're saved with the session.
export const MAX_HIDDEN_RESULTS = 100;

/** Sent to Soulseek peers as the search query — special characters confuse matching. */
export function cleanSearchTerm(term: string | undefined): string {
    if (!term) return "";
    return term
        .replace(/[:"/\\|?*()<>]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

// Soulseek file paths always use Windows-style backslash separators (the
// network is dominated by Windows shares), regardless of the OS this app
// runs on — parse with path.win32 explicitly rather than the platform-default
// `path` module, which would mis-split on macOS/Linux.
function parseFilePath(filePath: string) {
    const folderPath = path.win32.dirname(filePath);
    const fileExtension = path.win32.extname(filePath).slice(1).toLowerCase();
    const fileName = path.win32.basename(filePath, `.${fileExtension}`);
    return { folderPath, fileName, fileExtension };
}

function contains(haystack: string, needle: string): boolean {
    if (!needle) return false;
    return haystack.toLowerCase().includes(needle.toLowerCase());
}

export type RankingQuery = {
    artistName: string;
    trackTitle: string;
    albumName?: string;
    extension: string;
};

/**
 * Score a search result for ranking — higher is better, -1 means disqualified.
 * Carried over from the pre-refactor SoulseekService with its tuned weighting
 * (size/bitrate/speed + extended/club-mix bonuses) intact.
 *
 * A peer with no free upload slot is NOT disqualified: its file is still a real result worth
 * listing (it would just wait in that peer's queue). `rankResults` sorts those after every
 * free-slot result instead.
 */
export function calculateResultWeight(result: SlskFile, query: RankingQuery): number {
    const { folderPath, fileName, fileExtension } = parseFilePath(result.file);

    if (fileExtension !== query.extension) return -1;
    if (contains(fileName, "remix") !== contains(query.trackTitle, "remix")) return -1;

    const sizeInMB = result.size / (1024 * 1024);
    let score =
        sizeInMB > MAX_PREFERRED_SIZE_MB
            ? Math.log(result.size) / 10 - (sizeInMB - MAX_PREFERRED_SIZE_MB) / 10
            : Math.log(result.size) / 10;
    score += result.bitrate ? result.bitrate / 2000 : 0;
    score += Math.log(result.speed) / 20;

    if (contains(fileName, "extended")) score *= 3.0;
    if (contains(fileName, "club mix")) score *= 2.0;
    if (contains(fileName, query.trackTitle)) score *= 1.3;
    if (query.albumName && contains(folderPath, query.albumName)) score *= 1.3;

    return score;
}

/**
 * Rank + filter search results, best first, keeping the top `limit`.
 * Peers with a free upload slot come first (the only ones worth downloading from automatically —
 * a queued peer can take far longer than the download timeout), each group ordered by weight.
 * The same peer can answer a search more than once, so the exact same file (user + path)
 * is only kept once — slsk-client also keys its downloads by `user_file`, so duplicates
 * would collide inside the library anyway.
 */
export function rankResults(results: SlskFile[], query: RankingQuery, limit = Infinity): SlskFile[] {
    const seen = new Set<string>();
    const unique = results.filter((result) => {
        const key = `${result.user}\0${result.file}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    return unique
        .map((result) => ({ result, weight: calculateResultWeight(result, query) }))
        .filter(({ weight }) => weight >= 0)
        .sort((a, b) => Number(b.result.slots) - Number(a.result.slots) || b.weight - a.weight)
        .slice(0, limit)
        .map(({ result }) => result);
}

/** Reads the "results shown" setting (free text, so anything non-numeric falls back to the default). */
export function parseResultsLimit(value: unknown): number {
    const parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_RESULTS_LIMIT;
    return Math.min(parsed, MAX_HIDDEN_RESULTS);
}

/** "name.flac" out of a Soulseek path (always backslash-separated, whatever OS this runs on). */
export function remoteFileName(filePath: string): string {
    return path.win32.basename(filePath);
}
