import { type ConfidencePart, type TrackMetadata } from "#flows/musicDownloadFlow/types";

/**
 * Unicode-aware normalisation: lowercases, strips diacritics (`Beyoncé` → `beyonce`),
 * keeps letters/digits of every script (Cyrillic, CJK, Greek…) and collapses whitespace.
 * Returns "" when nothing comparable is left — callers must treat that as "no information".
 */
function normalize(s: string): string {
    return s
        .normalize("NFKD")
        .replace(/\p{M}/gu, "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, "")
        .replace(/\s+/g, " ")
        .trim();
}

/** Words that mark a different recording of the same song (a cover is not the original). */
const VERSION_MARKERS = [
    "live",
    "remix",
    "karaoke",
    "cover",
    "instrumental",
    "acoustic",
    "nightcore",
    "slowed",
    "sped",
    "tribute",
];
/**
 * The bar a search hit must clear (0–100, see `computeConfidenceScore`) for a metadata service to propose it. A
 * platform's search is open: its first hit can share only a remixer's name with the track, so a service scores its
 * candidates against the track and keeps the best one at or above this. Title alone is worth 40, so a same-title cover
 * by someone else does not pass.
 */
export const MIN_SEARCH_CONFIDENCE = 50;

const VERSION_PENALTY = 15;
const MAX_VERSION_PENALTY = 30;

function versionMarkers(...fields: string[]): Set<string> {
    const words = new Set(normalize(fields.join(" ")).split(" "));
    return new Set(VERSION_MARKERS.filter((m) => words.has(m)));
}

/** Penalty when one side is a live/remix/karaoke/cover… version and the other is not. */
function versionPenalty(source: TrackMetadata, primary: TrackMetadata): number {
    const src = versionMarkers(source.trackName ?? "", source.album?.albumName ?? "");
    const prim = versionMarkers(primary.trackName ?? "", primary.album?.albumName ?? "");
    let differing = 0;
    for (const m of VERSION_MARKERS) {
        if (src.has(m) !== prim.has(m)) differing++;
    }
    return Math.min(MAX_VERSION_PENALTY, differing * VERSION_PENALTY);
}

function extractYear(releaseDate: string | undefined): number | undefined {
    if (!releaseDate) return undefined;
    const year = parseInt(releaseDate.split("-")[0]);
    return isNaN(year) ? undefined : year;
}

/** True when `phrase` appears in `text` as whole words (both already normalised). */
function containsPhrase(text: string, phrase: string): boolean {
    return phrase.length >= 2 && ` ${text} `.includes(` ${phrase} `);
}

/**
 * Uploads on YouTube are named "Artist - Title" and credited to the CHANNEL, so the artist of an upload is often only
 * in its title ("Orelsan - Dans ma ville (clip non officiel)", channel "Paul LATOUR"). One side's artist found in the
 * other side's track name is worth the same as a partial artist match.
 */
function artistInOtherTitle(source: TrackMetadata, primary: TrackMetadata): boolean {
    const inTitle = (artists: TrackMetadata["artists"], title: string | undefined) => {
        const t = normalize(title ?? "");
        return !!t && artists.some((a) => containsPhrase(t, normalize(a.name)));
    };
    return inTitle(source.artists, primary.trackName) || inTitle(primary.artists, source.trackName);
}

/** The versions markers (live, remix…) that exactly one of the two tracks carries, for the breakdown. */
function differingMarkers(source: TrackMetadata, primary: TrackMetadata): string[] {
    const src = versionMarkers(source.trackName ?? "", source.album?.albumName ?? "");
    const prim = versionMarkers(primary.trackName ?? "", primary.album?.albumName ?? "");
    return VERSION_MARKERS.filter((m) => src.has(m) !== prim.has(m));
}

export type ConfidenceBreakdown = { score: number; parts: ConfidencePart[] };

/**
 * Scores how well `source` matches `primary` on a 0–100 scale, and says how the score adds up.
 * Primary source always returns 100. ISRC match short-circuits to 100.
 *
 * Breakdown:
 *   Track name exact:  40 pts  (substring: 25 pts)
 *   Artist name exact: 30 pts  (substring: 15 pts; the artist inside the other side's title: 15 pts)
 *   Duration ≤2% diff: 20 pts  (≤5%: 10 pts)
 *   Year match:        10 pts
 *   Version markers (live/remix/karaoke/cover…) on one side only: −15 pts each (max −30)
 *
 * A name that normalises to nothing counts as "no information" (0 pts), never as equal.
 */
export function computeConfidenceBreakdown(source: TrackMetadata, primary: TrackMetadata): ConfidenceBreakdown {
    // ISRC exact match is a definitive identifier
    if (source.isrc && primary.isrc && source.isrc === primary.isrc) {
        return { score: 100, parts: [{ label: "ISRC", points: 100, detail: `same ISRC ${source.isrc}` }] };
    }

    const parts: ConfidencePart[] = [];
    let score = 0;

    // Track name (40 pts)
    const srcName = normalize(source.trackName ?? "");
    const primName = normalize(primary.trackName ?? "");
    let titlePoints = 0;
    let titleDetail = "no title to compare";
    if (srcName && primName) {
        if (srcName === primName) {
            titlePoints = 40;
            titleDetail = "same title";
        } else if (srcName.includes(primName) || primName.includes(srcName)) {
            titlePoints = 25;
            titleDetail = "one title holds the other";
        } else {
            titleDetail = "different titles";
        }
    }
    score += titlePoints;
    parts.push({ label: "Title", points: titlePoints, detail: titleDetail });

    // First artist name (30 pts)
    const srcArtist = normalize(source.artists[0]?.name ?? "");
    const primArtist = normalize(primary.artists[0]?.name ?? "");
    let artistPoints = 0;
    let artistDetail = "no artist to compare";
    if (srcArtist && primArtist) {
        if (srcArtist === primArtist) {
            artistPoints = 30;
            artistDetail = "same artist";
        } else if (srcArtist.includes(primArtist) || primArtist.includes(srcArtist)) {
            artistPoints = 15;
            artistDetail = "one artist name holds the other";
        } else if (artistInOtherTitle(source, primary)) {
            artistPoints = 15;
            artistDetail = "the artist is in the other title";
        } else {
            artistDetail = "different artists";
        }
    }
    score += artistPoints;
    parts.push({ label: "Artist", points: artistPoints, detail: artistDetail });

    // Duration (20 pts)
    let durationPoints = 0;
    let durationDetail = "a duration is missing";
    if (source.duration && primary.duration) {
        const diff = Math.abs(source.duration - primary.duration) / primary.duration;
        durationDetail = `${(diff * 100).toFixed(1)}% apart`;
        if (diff <= 0.02) durationPoints = 20;
        else if (diff <= 0.05) durationPoints = 10;
    }
    score += durationPoints;
    parts.push({ label: "Duration", points: durationPoints, detail: durationDetail });

    // Release year (10 pts)
    const srcYear = extractYear(source.album?.releaseDate);
    const primYear = extractYear(primary.album?.releaseDate);
    let yearPoints = 0;
    let yearDetail = "a year is missing";
    if (srcYear && primYear) {
        yearPoints = srcYear === primYear ? 10 : 0;
        yearDetail = srcYear === primYear ? `both ${srcYear}` : `${srcYear} vs ${primYear}`;
    }
    score += yearPoints;
    parts.push({ label: "Year", points: yearPoints, detail: yearDetail });

    const penalty = versionPenalty(source, primary);
    if (penalty > 0) {
        score -= penalty;
        parts.push({
            label: "Version",
            points: -penalty,
            detail: `only one is ${differingMarkers(source, primary).join(", ")}`,
        });
    }

    return { score: Math.max(0, Math.min(99, score)), parts };
}

/** The 0–100 score alone (see `computeConfidenceBreakdown`). */
export function computeConfidenceScore(source: TrackMetadata, primary: TrackMetadata): number {
    return computeConfidenceBreakdown(source, primary).score;
}
