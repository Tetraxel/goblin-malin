import { type ParsedUrl } from "#base/urlParser";
import { type TrackUri } from "#flows/musicDownloadFlow/types";

/** The store a link is in when it does not say (`music.apple.com/album/…`). */
export const DEFAULT_STOREFRONT = "us";

/**
 * Reads an Apple Music link (`music.apple.com`, also the older `itunes.apple.com`):
 * - a track: `/<store>/album/<slug>/<albumId>?i=<trackId>` or `/<store>/song/<slug>/<trackId>`;
 * - an album: `/<store>/album/<slug>/<albumId>` (no `?i=`).
 * The id is Apple's number, the one the iTunes API, Songlink and MusicBrainz use. The slug is optional, the store
 * (`us`, `fr`…) too. Playlists, artists, stations and every other page: `null` (the iTunes API cannot read a playlist).
 */
export function parseAppleMusicUrl(url: string): ParsedUrl | null {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    const host = parsed.hostname.toLowerCase();
    if (host !== "music.apple.com" && host !== "itunes.apple.com" && host !== "geo.music.apple.com") return null;

    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments[0] && /^[a-z]{2}$/i.test(segments[0])) segments.shift();
    const [kind, ...rest] = segments;
    if (!kind || rest.length === 0 || rest.length > 2) return null;
    // The id is the last segment (`id123` on the older iTunes links).
    const id = rest[rest.length - 1].replace(/^id/, "");
    if (!/^\d+$/.test(id)) return null;

    switch (kind.toLowerCase()) {
        case "song":
            return { platform: "appleMusic", type: "track", id };
        case "album": {
            const trackId = parsed.searchParams.get("i");
            if (trackId) return /^\d+$/.test(trackId) ? { platform: "appleMusic", type: "track", id: trackId } : null;
            return { platform: "appleMusic", type: "album", id };
        }
        default:
            return null;
    }
}

/** The store a link points into (`fr` for `music.apple.com/fr/…`), else the default. */
export function appleMusicStorefront(url: string): string {
    try {
        const first = new URL(url).pathname.split("/").filter(Boolean)[0];
        return first && /^[a-z]{2}$/i.test(first) ? first.toLowerCase() : DEFAULT_STOREFRONT;
    } catch {
        return DEFAULT_STOREFRONT;
    }
}

/** The app's `uri` of a track given its id. */
export function appleMusicTrackUri(id: string): TrackUri<"appleMusic"> {
    return `APPLEMUSIC::TRACK::${id}` as TrackUri<"appleMusic">;
}

/** The canonical URL of a track given its id (Apple redirects it to the page with the song's name). */
export function appleMusicTrackUrl(id: string): string {
    return `https://music.apple.com/${DEFAULT_STOREFRONT}/song/${id}`;
}
