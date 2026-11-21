import { type TrackMetadata } from "#flows/musicDownloadFlow/types";
import { appleMusicTrackUri } from "./appleMusicUrl";

/**
 * One result of the iTunes Search / Lookup API (`itunes.apple.com/search|lookup`): a song (`wrapperType: "track"`,
 * `kind: "song"`) or, in an album's lookup, the album itself (`wrapperType: "collection"`). Only what the app reads;
 * every field may be missing.
 */
export type ITunesResult = {
    wrapperType?: string;
    kind?: string;
    trackId?: number;
    trackName?: string;
    artistId?: number;
    artistName?: string;
    artistViewUrl?: string;
    collectionId?: number;
    collectionName?: string;
    collectionType?: string;
    collectionArtistName?: string;
    collectionViewUrl?: string;
    trackViewUrl?: string;
    trackTimeMillis?: number;
    trackNumber?: number;
    trackCount?: number;
    discNumber?: number;
    releaseDate?: string;
    primaryGenreName?: string;
    isStreamable?: boolean;
};

export type ITunesAnswer = { resultCount?: number; results?: ITunesResult[] };

/** Only the fields the app reads (the API also gives prices, previews, artwork). */
export function slimITunesResult(r: ITunesResult): ITunesResult {
    return {
        wrapperType: r.wrapperType,
        kind: r.kind,
        trackId: r.trackId,
        trackName: r.trackName,
        artistId: r.artistId,
        artistName: r.artistName,
        artistViewUrl: r.artistViewUrl,
        collectionId: r.collectionId,
        collectionName: r.collectionName,
        collectionType: r.collectionType,
        collectionArtistName: r.collectionArtistName,
        collectionViewUrl: r.collectionViewUrl,
        trackViewUrl: r.trackViewUrl,
        trackTimeMillis: r.trackTimeMillis,
        trackNumber: r.trackNumber,
        trackCount: r.trackCount,
        discNumber: r.discNumber,
        releaseDate: r.releaseDate,
        primaryGenreName: r.primaryGenreName,
    };
}

/** An Apple address without the tracking parameter the API adds (`?uo=4`); the track's own `?i=` stays. */
export function cleanAppleUrl(url: string | undefined): string | undefined {
    if (!url) return undefined;
    try {
        const parsed = new URL(url);
        parsed.searchParams.delete("uo");
        return parsed.toString();
    } catch {
        return undefined;
    }
}

/** Letters and digits only, lower case, accents dropped: "Earth, Wind & Fire" and "earth-wind-fire" are the same. */
function squash(text: string): string {
    return text
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]/gu, "");
}

/** The name part of an artist page (`/us/artist/earth-wind-fire/123` → `earth-wind-fire`), when it has one. */
function artistPageSlug(url: string | undefined): string | undefined {
    if (!url) return undefined;
    try {
        const segments = new URL(url).pathname.split("/").filter(Boolean);
        const at = segments.indexOf("artist");
        const slug = at >= 0 ? segments[at + 1] : undefined;
        return slug && at + 2 < segments.length ? slug : undefined;
    } catch {
        return undefined;
    }
}

/**
 * The artists of Apple's one-text credit. "JAY-Z & Kanye West", "A, B & C" credit several artists, but "Earth, Wind &
 * Fire" and "Simon & Garfunkel" are one: the text alone cannot tell. Apple links a shared credit to the page of its
 * first artist and a band to its own page, so the credit is split only when its artist page is named after the first
 * name in it; otherwise (a band, no page, a page named another way) it stays whole.
 */
function splitArtists(text: string, artistUrl: string | undefined): string[] {
    const whole = text.trim();
    if (!whole) return [];
    const names = whole
        .split(/\s*(?:,|&)\s*/)
        .map((name) => name.trim())
        .filter(Boolean);
    const slug = artistPageSlug(artistUrl);
    if (names.length < 2 || !slug) return [whole];
    return squash(slug) === squash(names[0]) ? names : [whole];
}

/** Maps a song of the iTunes API to the app's metadata, or `null` when it is not a song or has no id or title. */
export function convertAppleMusicToTrack(r: ITunesResult): TrackMetadata | null {
    if (r.wrapperType !== "track" || (r.kind !== undefined && r.kind !== "song")) return null;
    const title = r.trackName?.trim();
    if (r.trackId === undefined || !title) return null;
    const id = String(r.trackId);
    const url = cleanAppleUrl(r.trackViewUrl) ?? `https://music.apple.com/us/song/${id}`;

    const artistUrl = cleanAppleUrl(r.artistViewUrl);
    const names = r.artistName ? splitArtists(r.artistName, artistUrl) : [];
    const artists = names.map((name, i) => ({
        type: "artist" as const,
        name,
        // Apple gives the page of the first credited artist only (or of the whole name when it is one artist).
        ...(i === 0 && r.artistId !== undefined
            ? { id: String(r.artistId), ...(artistUrl ? { url: artistUrl } : {}) }
            : {}),
    }));

    const albumId = r.collectionId !== undefined ? String(r.collectionId) : undefined;
    const albumUrl = cleanAppleUrl(r.collectionViewUrl);
    const albumPage = albumUrl ? new URL(albumUrl) : undefined;
    albumPage?.searchParams.delete("i");

    return {
        id,
        trackName: title,
        duration: r.trackTimeMillis && r.trackTimeMillis > 0 ? r.trackTimeMillis : undefined,
        trackNumber: r.trackNumber || undefined,
        url,
        uri: appleMusicTrackUri(id),
        artists,
        album:
            albumId && r.collectionName
                ? {
                      id: albumId,
                      albumName: r.collectionName,
                      totalTracks: r.trackCount || undefined,
                      releaseDate: r.releaseDate?.slice(0, 10),
                      url: albumPage?.toString() ?? `https://music.apple.com/us/album/${albumId}`,
                      uri: `itunes:album:${albumId}`,
                  }
                : undefined,
        genres: r.primaryGenreName ? [r.primaryGenreName] : undefined,
        platform: "appleMusic",
        apiProvider: "itunes",
        fetchedAt: new Date(),
        type: "track",
    };
}
