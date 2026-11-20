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

/** "Artist A & Artist B", "A, B & C": Apple credits several artists in one text. */
function splitArtists(text: string): string[] {
    return text
        .split(/\s*(?:,|&)\s*/)
        .map((name) => name.trim())
        .filter(Boolean);
}

/** Maps a song of the iTunes API to the app's metadata, or `null` when it is not a song or has no id or title. */
export function convertAppleMusicToTrack(r: ITunesResult): TrackMetadata | null {
    if (r.wrapperType !== "track" || (r.kind !== undefined && r.kind !== "song")) return null;
    const title = r.trackName?.trim();
    if (r.trackId === undefined || !title) return null;
    const id = String(r.trackId);
    const url = cleanAppleUrl(r.trackViewUrl) ?? `https://music.apple.com/us/song/${id}`;

    const names = r.artistName ? splitArtists(r.artistName) : [];
    const artistUrl = cleanAppleUrl(r.artistViewUrl);
    const artists = names.map((name, i) => ({
        type: "artist" as const,
        name,
        // Apple gives the page of the first credited artist only.
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
