import { type StandardArtist, type TrackMetadata } from "#flows/musicDownloadFlow/types";
import { deezerTrackUri } from "./deezerUrl";

/** An artist as Deezer's API gives it (on a track, in `artist` and in `contributors`). */
export type DeezerArtist = { id?: number; name?: string; link?: string; role?: string };

/**
 * A track as Deezer's public API gives it: `GET /track/<id>` (full), or an entry of `/search` or of an album's or a
 * playlist's track list (no `contributors`, no `release_date`, no `bpm`). Only what the app reads; every field may be
 * missing. Kept slim in the cache with `slimDeezerTrack` (the API also sends preview and image addresses, tokens…).
 */
export type DeezerTrack = {
    id?: number;
    readable?: boolean;
    title?: string;
    isrc?: string;
    link?: string;
    duration?: number; // seconds
    track_position?: number;
    release_date?: string;
    bpm?: number;
    contributors?: DeezerArtist[];
    artist?: DeezerArtist;
    album?: { id?: number; title?: string; link?: string; release_date?: string };
    type?: string;
};

/** The answer of every API call that failed: Deezer says 200 with an error object. */
export type DeezerError = { error?: { type?: string; message?: string; code?: number } };

function slimArtist(artist: DeezerArtist | undefined): DeezerArtist | undefined {
    return artist ? { id: artist.id, name: artist.name, link: artist.link, role: artist.role } : undefined;
}

/** Only the fields the app reads. */
export function slimDeezerTrack(track: DeezerTrack): DeezerTrack {
    return {
        id: track.id,
        readable: track.readable,
        title: track.title,
        isrc: track.isrc,
        link: track.link,
        duration: track.duration,
        track_position: track.track_position,
        release_date: track.release_date,
        bpm: track.bpm,
        contributors: track.contributors?.map((c) => slimArtist(c)!),
        artist: slimArtist(track.artist),
        album: track.album
            ? {
                  id: track.album.id,
                  title: track.album.title,
                  link: track.album.link,
                  release_date: track.album.release_date,
              }
            : undefined,
        type: track.type,
    };
}

function toArtist(artist: DeezerArtist): StandardArtist | null {
    const name = artist.name?.trim();
    if (!name) return null;
    const id = artist.id !== undefined ? String(artist.id) : undefined;
    return {
        type: "artist",
        name,
        ...(id ? { id, uri: `deezer:artist:${id}` } : {}),
        url: id ? `https://www.deezer.com/artist/${id}` : undefined,
    };
}

/**
 * Maps Deezer's description of a track to the app's metadata, or `null` when it has no id or title. The full track
 * lists every credited main artist (`contributors`); a search entry only has the first one (`artist`).
 */
export function convertDeezerToTrack(track: DeezerTrack): TrackMetadata | null {
    const title = track.title?.trim();
    if (track.id === undefined || !title) return null;
    const id = String(track.id);

    const credited = (track.contributors ?? []).filter((c) => !c.role || c.role === "Main");
    const artists = (credited.length > 0 ? credited : track.artist ? [track.artist] : [])
        .map(toArtist)
        .filter((a): a is StandardArtist => a !== null)
        .filter((a, i, all) => all.findIndex((b) => b.name === a.name) === i);

    const albumId = track.album?.id !== undefined ? String(track.album.id) : undefined;
    const albumName = track.album?.title?.trim();

    return {
        id,
        isrc: track.isrc || undefined,
        trackName: title,
        duration: track.duration && track.duration > 0 ? track.duration * 1000 : undefined,
        trackNumber: track.track_position || undefined,
        url: `https://www.deezer.com/track/${id}`,
        uri: deezerTrackUri(id),
        nativeAppUriDesktop: `deezer://www.deezer.com/track/${id}`,
        artists,
        album:
            albumId && albumName
                ? {
                      id: albumId,
                      albumName,
                      releaseDate: track.album?.release_date ?? track.release_date,
                      url: `https://www.deezer.com/album/${albumId}`,
                      uri: `deezer:album:${albumId}`,
                  }
                : undefined,
        bpm: track.bpm && track.bpm > 0 ? track.bpm : undefined,
        platform: "deezer",
        apiProvider: "deezer",
        fetchedAt: new Date(),
        type: "track",
    };
}
