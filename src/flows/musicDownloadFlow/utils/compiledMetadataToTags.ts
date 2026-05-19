import { CompiledMetadata } from "./compiledMetadata";
import { Metadata } from "#utils/metadata";

export interface TagOptions {
    includeMusicBrainzTags: boolean;
}

export function compiledMetadataToTags(compiled: CompiledMetadata, options: TagOptions): Metadata {
    return {
        trackTitle: compiled.trackName,
        artists: compiled.artists.map((a) => a.name),
        albumArtists: compiled.album?.artists?.map((a) => a.name),
        albumName: compiled.album?.albumName,
        year: compiled.year != null ? String(compiled.year) : undefined,
        trackNumber: compiled.trackNumber != null ? String(compiled.trackNumber) : undefined,
        isrc: compiled.isrc,
        genres: compiled.genres,
        bpm: compiled.bpm,
        key: compiled.key,
        ...(options.includeMusicBrainzTags
            ? {
                  musicBrainzTrackId: compiled.musicBrainzIds?.recording,
                  musicBrainzAlbumId: compiled.musicBrainzIds?.release,
                  musicBrainzArtistId: compiled.musicBrainzIds?.artist,
                  musicBrainzReleaseGroupId: compiled.musicBrainzIds?.releaseGroup,
              }
            : {}),
    };
}
