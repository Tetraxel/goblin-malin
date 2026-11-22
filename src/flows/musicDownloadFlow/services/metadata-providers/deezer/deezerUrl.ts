import { type ParsedUrl } from "#base/urlParser";
import { type TrackUri } from "#flows/musicDownloadFlow/types";

/** Short links (`link.deezer.com/s/<code>`, `deezer.page.link/<code>`) only say what they lead to once followed. */
const SHORT_LINK_HOSTS = new Set(["link.deezer.com", "deezer.page.link"]);

const KINDS: Record<string, ParsedUrl["type"]> = { track: "track", album: "album", playlist: "playlist" };

/**
 * Reads a Deezer link: `deezer.com/[<lang>/]track|album|playlist/<numeric id>` (with or without `www.`, any query).
 * The id is Deezer's own number, the one its API and every other site (Songlink, MusicBrainz) use. A short link is read
 * as a track whose id is the link itself (`link.deezer.com/s/<code>`): `DeezerService` follows it to learn the real
 * one. Artists, profiles, shows, episodes and every other page: `null`.
 */
export function parseDeezerUrl(url: string): ParsedUrl | null {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const segments = parsed.pathname.split("/").filter(Boolean);

    if (SHORT_LINK_HOSTS.has(host)) {
        if (segments.length === 0) return null;
        return { platform: "deezer", type: "track", id: `${host}/${segments.join("/")}` };
    }
    if (host !== "deezer.com") return null;

    // An optional language prefix: `/fr/track/…`, `/en/album/…`, `/pt-br/…`.
    if (segments.length === 3 && /^[a-z]{2}(-[a-z]{2})?$/i.test(segments[0])) segments.shift();
    if (segments.length !== 2) return null;
    const [kind, id] = segments;
    const type = KINDS[kind.toLowerCase()];
    if (!type || !/^\d+$/.test(id)) return null;
    return { platform: "deezer", type, id };
}

/**
 * Short-link hosts that no longer lead anywhere: `deezer.page.link` was a Firebase Dynamic Link, a service Google shut
 * down in August 2025 (every link answers 404). Still recognised, so the user is told why it fails.
 */
const DEAD_SHORT_LINK_HOSTS = new Set(["deezer.page.link"]);

/** True for a short link of a host that no longer works (see `DEAD_SHORT_LINK_HOSTS`). */
export function isDeadDeezerShortLinkId(id: string): boolean {
    return [...DEAD_SHORT_LINK_HOSTS].some((host) => id.startsWith(`${host}/`));
}

/** What the user is told about such a link. */
export const DEAD_SHORT_LINK_MESSAGE =
    "deezer.page.link links no longer work (Google shut that service down in 2025): share the track again from Deezer to get a link.deezer.com one";

/** True for an id that is a short link still to follow (see `parseDeezerUrl`). */
export function isDeezerShortLinkId(id: string): boolean {
    return [...SHORT_LINK_HOSTS].some((host) => id.startsWith(`${host}/`));
}

/** The app's `uri` of a track given its id. */
export function deezerTrackUri(id: string): TrackUri<"deezer"> {
    return `DEEZER::TRACK::${id}` as TrackUri<"deezer">;
}

/** The canonical URL of a track given its id. */
export function deezerTrackUrl(id: string): string {
    return isDeezerShortLinkId(id) ? `https://${id}` : `https://www.deezer.com/track/${id}`;
}

/** The address that opens a Deezer link in the desktop app. */
export function deezerOpenUri(parsed: ParsedUrl): string | undefined {
    if (!parsed.id || isDeezerShortLinkId(parsed.id) || parsed.type === "unknown") return undefined;
    return `deezer://www.deezer.com/${parsed.type}/${parsed.id}`;
}
