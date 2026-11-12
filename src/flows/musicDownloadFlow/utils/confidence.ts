import { type TrackMetadata } from "#flows/musicDownloadFlow/types";

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

/**
 * Scores how well `source` matches `primary` on a 0–100 scale.
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
export function computeConfidenceScore(source: TrackMetadata, primary: TrackMetadata): number {
    // ISRC exact match is a definitive identifier
    if (source.isrc && primary.isrc && source.isrc === primary.isrc) return 100;

    let score = 0;

    // Track name (40 pts)
    const srcName = normalize(source.trackName ?? "");
    const primName = normalize(primary.trackName ?? "");
    if (srcName && primName) {
        if (srcName === primName) {
            score += 40;
        } else if (srcName.includes(primName) || primName.includes(srcName)) {
            score += 25;
        }
    }

    // First artist name (30 pts)
    const srcArtist = normalize(source.artists[0]?.name ?? "");
    const primArtist = normalize(primary.artists[0]?.name ?? "");
    if (srcArtist && primArtist) {
        if (srcArtist === primArtist) {
            score += 30;
        } else if (srcArtist.includes(primArtist) || primArtist.includes(srcArtist)) {
            score += 15;
        } else if (artistInOtherTitle(source, primary)) {
            score += 15;
        }
    }

    // Duration (20 pts)
    if (source.duration && primary.duration) {
        const diff = Math.abs(source.duration - primary.duration) / primary.duration;
        if (diff <= 0.02) score += 20;
        else if (diff <= 0.05) score += 10;
    }

    // Release year (10 pts)
    const srcYear = extractYear(source.album?.releaseDate);
    const primYear = extractYear(primary.album?.releaseDate);
    if (srcYear && primYear && srcYear === primYear) {
        score += 10;
    }

    score -= versionPenalty(source, primary);

    return Math.max(0, Math.min(99, score));
}
