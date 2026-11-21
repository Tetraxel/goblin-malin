import { type ParsedUrl } from "#base/urlParser";
import { type TrackUri } from "#flows/musicDownloadFlow/types";

const HOSTS = new Set(["tidal.com", "listen.tidal.com", "embed.tidal.com"]);

/**
 * Reads a Tidal track link: `tidal.com/[browse/]track/<id>`, `listen.tidal.com/track/<id>`,
 * `tidal.com/album/<albumId>/track/<id>`, `embed.tidal.com/tracks/<id>`, with any query. The id is Tidal's number (the
 * one Songlink and MusicBrainz use). Albums, playlists, artists, videos: `null` (their public page lists no tracks, and
 * Tidal's API needs a key).
 */
export function parseTidalUrl(url: string): ParsedUrl | null {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (!HOSTS.has(host)) return null;

    const segments = parsed.pathname.split("/").filter(Boolean);
    // A link from the "Share" button ends in `/u` (`tidal.com/track/<id>/u`), and a page may carry a region (`/us/…`).
    if (segments.at(-1)?.toLowerCase() === "u") segments.pop();
    if (/^[a-z]{2}$/i.test(segments[0] ?? "") && segments.length > 2) segments.shift();
    if (segments[0]?.toLowerCase() === "browse") segments.shift();
    // `/album/<albumId>/track/<id>`: the track inside an album page.
    if (segments.length === 4 && segments[0].toLowerCase() === "album") segments.splice(0, 2);
    if (segments.length !== 2) return null;
    const [kind, id] = segments;
    if (!["track", "tracks"].includes(kind.toLowerCase()) || !/^\d+$/.test(id)) return null;
    return { platform: "tidal", type: "track", id };
}

/** The app's `uri` of a track given its id. */
export function tidalTrackUri(id: string): TrackUri<"tidal"> {
    return `TIDAL::TRACK::${id}` as TrackUri<"tidal">;
}

/** The canonical URL of a track given its id. */
export function tidalTrackUrl(id: string): string {
    return `https://tidal.com/track/${id}`;
}

/** The address that opens a Tidal track in the desktop app. */
export function tidalOpenUri(parsed: ParsedUrl): string | undefined {
    return parsed.type === "track" && parsed.id ? `tidal://track/${parsed.id}` : undefined;
}
