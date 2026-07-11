import * as path from "path";
import { SlskFile } from "slsk-client";

// Files bigger than this are less interesting — likely a whole album/rip
// rather than a single track.
const MAX_PREFERRED_SIZE_MB = 50;

// Only the top-ranked candidates are attempted, in order, before giving up.
export const MAX_DOWNLOAD_ATTEMPTS = 5;

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
 */
export function calculateResultWeight(result: SlskFile, query: RankingQuery): number {
    const { folderPath, fileName, fileExtension } = parseFilePath(result.file);

    if (fileExtension !== query.extension) return -1;
    if (!result.slots) return -1;
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

/** Rank + filter search results, keeping only the top `MAX_DOWNLOAD_ATTEMPTS` candidates. */
export function rankResults(results: SlskFile[], query: RankingQuery): SlskFile[] {
    return results
        .map((result) => ({ result, weight: calculateResultWeight(result, query) }))
        .filter(({ weight }) => weight >= 0)
        .sort((a, b) => b.weight - a.weight)
        .slice(0, MAX_DOWNLOAD_ATTEMPTS)
        .map(({ result }) => result);
}
