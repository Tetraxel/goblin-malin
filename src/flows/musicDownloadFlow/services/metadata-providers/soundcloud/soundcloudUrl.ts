import { type ParsedUrl } from "#base/urlParser";
import { type TrackUri } from "#flows/musicDownloadFlow/types";

/** Short links (`on.soundcloud.com/<code>`) cannot be turned into a permalink without asking SoundCloud. */
const SHORT_LINK_HOST = "on.soundcloud.com";

/** First path segments that are pages of the site, not a user's profile. */
const RESERVED_USER_SEGMENTS = new Set([
    "discover",
    "stream",
    "you",
    "upload",
    "search",
    "charts",
    "pages",
    "settings",
    "terms-of-use",
    "jobs",
    "imprint",
    "creators",
    "mobile",
    "messages",
    "notifications",
    "feed",
    "popular",
    "tags",
    "people",
    "legal",
    "community-guidelines",
    "go",
    "logout",
]);

/** Second path segments that are a tab of a profile or a playlist, not a track. */
const NON_TRACK_SEGMENTS = new Set([
    "sets",
    "albums",
    "tracks",
    "likes",
    "reposts",
    "following",
    "followers",
    "comments",
    "spotlight",
    "popular-tracks",
    "insights",
    "playlists",
]);

/**
 * Reads a SoundCloud link. A track is `soundcloud.com/<user>/<track>`, plus `/s-<token>` when it is private.
 * The id is that permalink (`<user>/<track>`): readable, stable enough to dedupe on, and what the track's URL is built
 * from (`soundcloudTrackUrl`). Playlists (`/sets/`), profiles, and every other page are not tracks: `null`.
 */
export function parseSoundCloudUrl(url: string): ParsedUrl | null {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");

    if (host === SHORT_LINK_HOST) {
        const code = parsed.pathname.split("/").filter(Boolean)[0];
        return code ? { platform: "soundcloud", type: "track", id: `${SHORT_LINK_HOST}/${code}` } : null;
    }

    if (host !== "soundcloud.com" && host !== "m.soundcloud.com") return null;

    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length < 2 || segments.length > 3) return null;
    const [user, track, secret] = segments;
    if (RESERVED_USER_SEGMENTS.has(user.toLowerCase())) return null;
    if (NON_TRACK_SEGMENTS.has(track.toLowerCase())) return null;
    // The third segment only exists for a private link (`s-AbCd123`); anything else is a page under the track.
    if (secret !== undefined && !/^s-[A-Za-z0-9]+$/.test(secret)) return null;

    // SoundCloud permalinks are not case-sensitive (`Flume/Song` and `flume/song` are one page): lower-cased, so one
    // track has one id. The secret token and the short-link code are case-sensitive and are left as written.
    return {
        platform: "soundcloud",
        type: "track",
        id: [user.toLowerCase(), track.toLowerCase(), ...(secret !== undefined ? [secret] : [])].join("/"),
    };
}

/** The app's `uri` of a track given its id (see `parseSoundCloudUrl`). */
export function soundcloudTrackUri(id: string): TrackUri<"soundcloud"> {
    return `SOUNDCLOUD::TRACK::${id}` as TrackUri<"soundcloud">;
}

/** The canonical URL of a track given its id (see `parseSoundCloudUrl`). */
export function soundcloudTrackUrl(id: string): string {
    return id.startsWith(`${SHORT_LINK_HOST}/`) ? `https://${id}` : `https://soundcloud.com/${id}`;
}
