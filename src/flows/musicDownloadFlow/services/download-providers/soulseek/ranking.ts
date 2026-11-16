import * as path from "path";
import { FileAttribute, type FileAttributes, type SearchResult } from "slsk-client";

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
    return (
        term
            .replace(/[:"/\\|?*()<>]/g, " ")
            // A word that starts with "-" is an exclusion in a Soulseek search ("Artist - Title" would exclude "Title").
            .replace(/(^|\s)-+/g, "$1")
            .replace(/\s+/g, " ")
            .trim()
    );
}

/** Words that make a recording another version: a search must keep them, and a file must agree with the title on them. */
const VERSION_WORDS = /remix|live|instrumental|karaoke|a ?cappella|acoustic|extended|club mix/i;

/**
 * The title as a looser search would write it: streaming titles carry words that files rarely have ("(feat. X)",
 * "- 2011 Remaster", "- Radio Edit"), and Soulseek wants every word. Parts that name another version (a remix, a live
 * take) stay. Returns the title as it was when there is nothing to take off.
 */
export function relaxedTitle(title: string): string {
    const relaxed = title
        .replace(/\s*[([][^)\]]*[)\]]/g, (group) => (VERSION_WORDS.test(group) ? group : ""))
        .replace(/\s+-\s+.*$/, (suffix) => (VERSION_WORDS.test(suffix) ? suffix : ""))
        .replace(/\s+(feat\.?|ft\.?|featuring)\s.*$/i, "")
        .trim();
    return relaxed || title;
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

/** Whether `text` has `word` as a whole word (not "live" in "alive"). Letters and digits of any script are word characters. */
function hasWord(text: string, word: string): boolean {
    const spaced = word.replace(/ /g, "\\s+");
    return new RegExp(`(^|[^\\p{L}\\p{N}])${spaced}($|[^\\p{L}\\p{N}])`, "iu").test(text);
}

const PARITY_WORDS = ["live", "instrumental", "karaoke", "acapella", "a cappella", "acoustic", "extended", "club mix"];

/** `text` without the first occurrence of `part` (case-insensitive), or as it is when `part` is not in it. */
function withoutFirst(text: string, part: string): string {
    return text.replace(new RegExp(part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu"), " ");
}

/**
 * A file and the wanted title disagree on whether this is the live / instrumental / karaoke… version. The file name
 * usually starts with the artist: when a version word is part of the artist's own name (the band Live, Acoustic
 * Alchemy), that one mention is the artist, not the version, so it is not counted.
 */
function disagreesOnVersion(fileName: string, trackTitle: string, artistName: string): boolean {
    return PARITY_WORDS.some((word) => {
        const name = artistName && hasWord(artistName, word) ? withoutFirst(fileName, artistName) : fileName;
        return hasWord(name, word) !== hasWord(trackTitle, word);
    });
}

export type RankingQuery = {
    artistName: string;
    trackTitle: string;
    albumName?: string;
    extension: string;
    /** The track's length, when the metadata knows it. */
    durationMs?: number;
};

/**
 * How far a file's duration may drift from the track's before it is taken for another recording (a DJ set,
 * an album rip, another version). Checked twice: on the length the peer announces in its search result, and
 * on the length measured in the downloaded file, for peers that announce none.
 */
export const DURATION_TOLERANCE_MS = 10_000;

/** The audio details a peer announced for a file. Any of them can be missing: peers send what they want. */
export type AnnouncedAudio = {
    durationMs?: number;
    bitrateKbps?: number;
    sampleRateHz?: number;
    bitDepth?: number;
};

export function announcedAudio(result: { attribs?: FileAttributes }): AnnouncedAudio {
    const attribs = result.attribs ?? {};
    const seconds = attribs[FileAttribute.Duration];
    return {
        durationMs: seconds ? seconds * 1000 : undefined,
        bitrateKbps: attribs[FileAttribute.Bitrate] || undefined,
        sampleRateHz: attribs[FileAttribute.SampleRate] || undefined,
        bitDepth: attribs[FileAttribute.BitDepth] || undefined,
    };
}

/**
 * Score a search result for ranking — higher is better, -1 means disqualified.
 * Carried over from the pre-refactor SoulseekService with its tuned weighting
 * (size/bitrate/speed + extended/club-mix bonuses) intact.
 *
 * A peer with no free upload slot is NOT disqualified: its file is still a real result worth
 * listing (it would just wait in that peer's queue). `rankResults` sorts those after every
 * free-slot result instead, and among them a shorter queue scores higher.
 */
export function calculateResultWeight(result: SearchResult, query: RankingQuery): number {
    const { folderPath, fileName, fileExtension } = parseFilePath(result.file);
    const audio = announcedAudio(result);

    if (fileExtension !== query.extension) return -1;
    if (contains(fileName, "remix") !== contains(query.trackTitle, "remix")) return -1;
    // The other versions a title names (live, instrumental, karaoke…) must be the file's too, both ways.
    if (disagreesOnVersion(fileName, query.trackTitle, query.artistName)) return -1;
    // Not worth downloading only to measure it and throw it away.
    if (
        query.durationMs != null &&
        audio.durationMs != null &&
        Math.abs(audio.durationMs - query.durationMs) > DURATION_TOLERANCE_MS
    ) {
        return -1;
    }

    const sizeInMB = result.size / (1024 * 1024);
    let score =
        sizeInMB > MAX_PREFERRED_SIZE_MB
            ? Math.log1p(result.size) / 10 - (sizeInMB - MAX_PREFERRED_SIZE_MB) / 10
            : Math.log1p(Math.max(0, result.size)) / 10;
    score += audio.bitrateKbps ? audio.bitrateKbps / 2000 : 0;
    // log1p: a peer that reports a speed of 0 (many do until they have uploaded something), or a file of size 0, scores
    // low instead of -Infinity, which would drop it from the results altogether.
    score += Math.log1p(Math.max(0, result.speed)) / 20;

    // The extended and club versions are a bonus only for a title that asks for them (the parity check above already
    // rules out a file that has them when the title does not).
    if (hasWord(query.trackTitle, "extended") && hasWord(fileName, "extended")) score *= 3.0;
    if (hasWord(query.trackTitle, "club mix") && hasWord(fileName, "club mix")) score *= 2.0;
    if (contains(fileName, query.trackTitle)) score *= 1.3;
    if (query.albumName && contains(folderPath, query.albumName)) score *= 1.3;
    // Below CD quality, the file was downsampled somewhere along the way; 24-bit is a real hi-res master.
    if (audio.sampleRateHz != null && audio.sampleRateHz < 44_100) score *= 0.5;
    if (audio.bitDepth != null && audio.bitDepth >= 24) score *= 1.1;
    // Every file already waiting in that peer's queue is a wait before ours starts.
    if (!result.slots && result.queueLength) score /= 1 + Math.log1p(result.queueLength) / 3;

    return score;
}

/**
 * Rank + filter search results, best first, keeping the top `limit`.
 * Peers with a free upload slot come first (the only ones worth downloading from automatically —
 * a queued peer can take far longer than the download timeout), each group ordered by weight.
 * The same peer can answer a search more than once, so the exact same file (user + path)
 * is only kept once.
 */
export function rankResults(results: SearchResult[], query: RankingQuery, limit = Infinity): SearchResult[] {
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
