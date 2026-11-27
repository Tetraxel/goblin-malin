// @ts-check
/**
 * Matching the tracks of the list against the files of a library. Pure functions, no `goblin`: the unit tests import
 * this file directly (tests/unit/extensionSamples.test.ts).
 */

/** Seconds two durations may differ by and still be the same recording. */
export const DURATION_TOLERANCE_MS = 3000;

/** Words in brackets that say nothing about which recording it is. */
const NOISE =
    /[([][^)\]]*\b(?:remaster(?:ed)?|official|video|audio|lyrics?|hd|hq|explicit|clean|mono|stereo)\b[^)\]]*[)\]]/gi;

/**
 * A title or an artist reduced to what identifies it: lower case, no accents, no "(Remastered 2011)", no "feat. …",
 * only letters and digits.
 * @param {string | undefined} text
 */
export function normalise(text) {
    if (!text) return "";
    return text
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(NOISE, " ")
        .replace(/\s[-–]\s.*remaster.*$/i, " ")
        .replace(/\b(?:feat|ft|featuring)\.?\s.*$/i, " ")
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

/** @param {string | undefined} isrc */
export function normaliseIsrc(isrc) {
    const clean = (isrc ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    return clean.length === 12 ? clean : "";
}

/**
 * @typedef {{ id: string, title?: string, artists: readonly string[], isrc?: string, durationMs?: number }} TrackLike
 * @typedef {{ path: string, title?: string, artists: readonly string[], isrc?: string, durationMs?: number }} FileLike
 * @typedef {{ trackId: string, file: string, by: "isrc" | "name" }} Match
 */

/** @param {{ title?: string, artists: readonly string[] }} t */
function nameKey(t) {
    const title = normalise(t.title);
    const artist = normalise(t.artists[0]);
    return title && artist ? `${artist}\u0000${title}` : "";
}

/**
 * The tracks that are already in the library: same ISRC, else same first artist and title (normalised) and, when
 * both durations are known and `useDuration`, durations within 3 s.
 * @param {readonly TrackLike[]} tracks
 * @param {readonly FileLike[]} files
 * @param {{ useDuration?: boolean }} [options]
 * @returns {Match[]}
 */
export function findOwned(tracks, files, options = {}) {
    const useDuration = options.useDuration !== false;
    /** @type {Map<string, FileLike>} */
    const byIsrc = new Map();
    /** @type {Map<string, FileLike[]>} */
    const byName = new Map();
    for (const file of files) {
        const isrc = normaliseIsrc(file.isrc);
        if (isrc && !byIsrc.has(isrc)) byIsrc.set(isrc, file);
        const key = nameKey(file);
        if (key) byName.set(key, [...(byName.get(key) ?? []), file]);
    }
    /** @type {Match[]} */
    const matches = [];
    for (const track of tracks) {
        const isrc = normaliseIsrc(track.isrc);
        const sameIsrc = isrc ? byIsrc.get(isrc) : undefined;
        if (sameIsrc) {
            matches.push({ trackId: track.id, file: sameIsrc.path, by: "isrc" });
            continue;
        }
        const key = nameKey(track);
        if (!key) continue;
        const candidates = byName.get(key) ?? [];
        const hit = candidates.find((file) => {
            if (!useDuration || track.durationMs === undefined || file.durationMs === undefined) return true;
            return Math.abs(track.durationMs - file.durationMs) <= DURATION_TOLERANCE_MS;
        });
        if (hit) matches.push({ trackId: track.id, file: hit.path, by: "name" });
    }
    return matches;
}
