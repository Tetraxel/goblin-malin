import { type ParsedUrl } from "#base/urlParser";
import { type TrackUri } from "#flows/musicDownloadFlow/types";

/** An Amazon Standard Identification Number: 10 capital letters or digits (`B07DN7XVCC`). */
const ASIN = /^[A-Z0-9]{10}$/;

/**
 * Reads an Amazon Music track link, on any of Amazon's country sites (`music.amazon.com`, `music.amazon.fr`,
 * `music.amazon.co.uk`…): `/tracks/<ASIN>`, or `/albums/<ASIN>?trackAsin=<ASIN>` (a track shown in its album, the
 * form Songlink gives). The id is the track's ASIN. Albums, playlists, artists, podcasts and the Amazon shop: `null`.
 */
export function parseAmazonMusicUrl(url: string): ParsedUrl | null {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    const host = parsed.hostname.toLowerCase();
    if (!/^music\.amazon\.[a-z]{2,3}(\.[a-z]{2})?$/.test(host)) return null;

    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length !== 2) return null;
    const [kind, id] = segments;
    switch (kind.toLowerCase()) {
        case "tracks":
            return ASIN.test(id) ? { platform: "amazonMusic", type: "track", id } : null;
        case "albums": {
            const track = parsed.searchParams.get("trackAsin");
            return track && ASIN.test(track) && ASIN.test(id)
                ? { platform: "amazonMusic", type: "track", id: track }
                : null;
        }
        default:
            return null;
    }
}

/** The app's `uri` of a track given its ASIN. */
export function amazonMusicTrackUri(id: string): TrackUri<"amazonMusic"> {
    return `AMAZONMUSIC::TRACK::${id}` as TrackUri<"amazonMusic">;
}

/** The canonical URL of a track given its ASIN. */
export function amazonMusicTrackUrl(id: string): string {
    return `https://music.amazon.com/tracks/${id}`;
}
