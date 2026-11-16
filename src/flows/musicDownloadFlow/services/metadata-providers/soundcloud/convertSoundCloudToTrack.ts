import { type StandardArtist, type TrackMetadata } from "#flows/musicDownloadFlow/types";
import { splitArtistAndTitle } from "#flows/musicDownloadFlow/utils/splitArtistAndTitle";
import { parseSoundCloudUrl, soundcloudTrackUri } from "./soundcloudUrl";

/**
 * What yt-dlp prints for a SoundCloud track (`--dump-single-json`), or for one entry of a flat `scsearch` listing: the
 * same fields in both. Only what the app reads is listed; every field may be missing.
 */
export type SoundCloudInfo = {
    id?: string | number;
    title?: string;
    /** The title as the uploader credits the track; yt-dlp copies the title when SoundCloud has nothing better. */
    track?: string;
    /** The credited artist(s), when the uploader filled in SoundCloud's "publisher" fields. */
    artist?: string;
    artists?: string[];
    uploader?: string;
    uploader_id?: string | number;
    uploader_url?: string;
    duration?: number; // seconds, fractional
    /** The canonical page of the track. (`url` is an API address: never use it.) */
    webpage_url?: string;
    genre?: string;
    genres?: string[];
    thumbnail?: string;
    _type?: string;
};

/**
 * Only the fields the app reads. yt-dlp's answer also holds the track's whole description, every audio format and its
 * stream addresses (a track page is ~50 KB of JSON): too much to keep in the disk cache for each track and search.
 */
export function slimSoundCloudInfo(info: SoundCloudInfo): SoundCloudInfo {
    return {
        id: info.id,
        title: info.title,
        track: info.track,
        artist: info.artist,
        artists: info.artists,
        uploader: info.uploader,
        uploader_id: info.uploader_id,
        uploader_url: info.uploader_url,
        duration: info.duration,
        webpage_url: info.webpage_url,
        genre: info.genre,
        genres: info.genres,
        thumbnail: info.thumbnail,
        _type: info._type,
    };
}

function artistsOf(info: SoundCloudInfo, split: { artist: string } | null): StandardArtist[] {
    // The credited artist is what the uploader declared: trust it before guessing from the title. `artists` is
    // already a list (a name with a comma in it, "Tyler, The Creator", stays whole); only the single `artist` text is
    // split, and only on `;`, since a comma is as likely to be part of a name as a separator.
    const credited = (info.artists?.length ? info.artists : (info.artist?.split(/\s*;\s*/) ?? []))
        .map((a) => a.trim())
        .filter(Boolean);
    if (credited.length > 0) return [...new Set(credited)].map((name) => ({ type: "artist" as const, name }));

    if (split) return [{ type: "artist", name: split.artist }];

    if (info.uploader) {
        const id = info.uploader_id !== undefined ? String(info.uploader_id) : undefined;
        return [
            {
                type: "artist",
                ...(id ? { id } : {}),
                name: info.uploader,
                ...(info.uploader_url ? { url: info.uploader_url } : {}),
                ...(id ? { uri: `soundcloud:user:${id}` } : {}),
            },
        ];
    }
    return [];
}

/**
 * Maps yt-dlp's description of a SoundCloud track to the app's metadata, or `null` when it has no usable page
 * address or title. `fetchedBy` is set by discovery services, never here: this is the platform's own answer.
 *
 * `readAsId` keeps the id a pasted link was read as (a short link, a renamed permalink) in place of the page's own:
 * the link the user pasted is stored under that id and must find its row again. `url` stays SoundCloud's page.
 */
export function convertSoundCloudToTrack(info: SoundCloudInfo, readAsId?: string): TrackMetadata | null {
    const rawTitle = (info.track ?? info.title ?? "").trim();
    if (!rawTitle || !info.webpage_url) return null;

    // Query and fragment are not part of the track's address (`?in=<playlist>`, `?utm_…`).
    let url: string;
    try {
        const parsed = new URL(info.webpage_url);
        url = `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
    } catch {
        return null;
    }
    // The page must be a track's; the id is then the page's permalink, or the one the caller read the link as.
    const pageId = parseSoundCloudUrl(url)?.id;
    if (!pageId) return null;
    const id = readAsId ?? pageId;

    // Only an upload without a declared artist is worth splitting: "Artist - Title" is then the best clue there is.
    const hasCredit = !!info.artist || (info.artists?.length ?? 0) > 0;
    const split = hasCredit ? null : splitArtistAndTitle(rawTitle, info.uploader);
    const genres = info.genres?.length ? info.genres : info.genre ? [info.genre] : undefined;

    return {
        id,
        trackName: split?.track ?? rawTitle,
        duration: info.duration && info.duration > 0 ? Math.round(info.duration * 1000) : undefined,
        url,
        uri: soundcloudTrackUri(id),
        isUpload: true,
        artists: artistsOf(info, split),
        genres,
        platform: "soundcloud",
        apiProvider: "soundcloud",
        fetchedAt: new Date(),
        type: "track",
    };
}
