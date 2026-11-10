import * as fs from "fs";
import NodeId3 from "node-id3";
import { globalLogger } from "#base/logger/logger";
import { cleanAndTagFlac, type Metadata } from "#utils/metadata";
import { runFfmpeg } from "./ffmpegRun";
import { extensionOf } from "./outputFormat";

/** Several values (artists, genres) in a format with one text field per tag: shown the way the UI joins them. */
const joinValues = (values: readonly string[]) => values.join(", ");

/** The picard-compatible ID3 `TXXX` descriptions of the MusicBrainz ids that have no frame of their own. */
const ID3_MUSICBRAINZ_TEXT = {
    musicBrainzAlbumId: "MusicBrainz Album Id",
    musicBrainzArtistId: "MusicBrainz Artist Id",
    musicBrainzReleaseGroupId: "MusicBrainz Release Group Id",
} as const;

async function tagMp3(filePath: string, metadata: Metadata): Promise<void> {
    const userDefinedText = (Object.keys(ID3_MUSICBRAINZ_TEXT) as (keyof typeof ID3_MUSICBRAINZ_TEXT)[])
        .filter((key) => metadata[key])
        .map((key) => ({ description: ID3_MUSICBRAINZ_TEXT[key], value: metadata[key] as string }));

    const tags: NodeId3.Tags = {
        title: metadata.trackTitle,
        artist: joinValues(metadata.artists),
        performerInfo: joinValues(metadata.albumArtists ?? metadata.artists),
        ...(metadata.albumName ? { album: metadata.albumName } : {}),
        ...(metadata.year ? { year: metadata.year } : {}),
        ...(metadata.trackNumber ? { trackNumber: metadata.trackNumber } : {}),
        ...(metadata.isrc ? { ISRC: metadata.isrc } : {}),
        ...(metadata.genres?.length ? { genre: joinValues(metadata.genres) } : {}),
        ...(metadata.bpm != null ? { bpm: String(metadata.bpm) } : {}),
        ...(metadata.key ? { initialKey: metadata.key } : {}),
        ...(userDefinedText.length ? { userDefinedText } : {}),
        ...(metadata.musicBrainzTrackId
            ? {
                  uniqueFileIdentifier: [
                      {
                          ownerIdentifier: "http://musicbrainz.org",
                          identifier: Buffer.from(metadata.musicBrainzTrackId),
                      },
                  ],
              }
            : {}),
    };

    // `update` keeps the frames the file already has (cover art, comments…) and replaces only the ones given.
    await NodeId3.Promise.update(tags, filePath);
    globalLogger.info("MP3 (ID3) metadata updated successfully! ✅");
}

/** The tag names ffmpeg writes: Vorbis comments for Ogg / Opus, MP4 atoms for M4A. */
function ffmpegTagEntries(ext: string, metadata: Metadata): [string, string][] {
    const isMp4 = ext === "m4a";
    const entries: [string, string | undefined][] = [
        [isMp4 ? "title" : "TITLE", metadata.trackTitle],
        [isMp4 ? "artist" : "ARTIST", joinValues(metadata.artists)],
        [isMp4 ? "album_artist" : "ALBUMARTIST", joinValues(metadata.albumArtists ?? metadata.artists)],
        [isMp4 ? "album" : "ALBUM", metadata.albumName],
        [isMp4 ? "date" : "DATE", metadata.year],
        [isMp4 ? "track" : "TRACKNUMBER", metadata.trackNumber],
        [isMp4 ? "genre" : "GENRE", metadata.genres?.length ? joinValues(metadata.genres) : undefined],
        ["ISRC", metadata.isrc],
        ["BPM", metadata.bpm != null ? String(metadata.bpm) : undefined],
        ["KEY", metadata.key],
        ["MUSICBRAINZ_TRACKID", metadata.musicBrainzTrackId],
        ["MUSICBRAINZ_ALBUMID", metadata.musicBrainzAlbumId],
        ["MUSICBRAINZ_ARTISTID", metadata.musicBrainzArtistId],
        ["MUSICBRAINZ_RELEASEGROUPID", metadata.musicBrainzReleaseGroupId],
    ];
    return entries.filter((e): e is [string, string] => e[1] !== undefined && e[1] !== "");
}

/**
 * Rewrites the tags of an Ogg, Opus or M4A file by remuxing it (`-c copy`: the audio is not touched). The tags the
 * file had are replaced by the app's own set, not merged with it: for these formats the file comes from the app's
 * conversion or from yt-dlp, whose leftovers (comment, URL…) are not worth keeping.
 */
async function tagWithFfmpeg(filePath: string, metadata: Metadata): Promise<void> {
    const ext = extensionOf(filePath);
    // Not an audio extension: a leftover from a crash must not look like a track in the library. ffmpeg can no
    // longer guess the container from the name, so it is given explicitly.
    const rewritten = `${filePath}.tagging`;
    const args = [
        "-i",
        filePath,
        "-f",
        ext === "m4a" ? "ipod" : ext,
        "-map",
        "0:a",
        "-c",
        "copy",
        // Start from no tags, container-wide and on the audio stream: Ogg / Opus keep their comments on the stream,
        // and where both exist the old stream value would win over the new one.
        "-map_metadata",
        "-1",
        "-map_metadata:s:a",
        "-1",
        ...ffmpegTagEntries(ext, metadata).flatMap(([key, value]) => ["-metadata", `${key}=${value}`]),
        // Without this the MP4 muxer silently drops every tag it has no atom for (ISRC, BPM, MusicBrainz ids).
        ...(ext === "m4a" ? ["-movflags", "use_metadata_tags"] : []),
        rewritten,
    ];
    try {
        await runFfmpeg(args);
        await fs.promises.rename(rewritten, filePath);
    } catch (error) {
        await fs.promises.rm(rewritten, { force: true });
        throw error;
    }
    globalLogger.info(`${ext.toUpperCase()} metadata updated successfully! ✅`);
}

/**
 * Writes `metadata` into a saved file, in the tag system its format uses: Vorbis comments for FLAC, Ogg and
 * Opus, ID3 for MP3, MP4 atoms for M4A. Unlike `cleanAndTagFlac`, a failure here is thrown, so the save is
 * reported as failed instead of leaving an untagged file that looks saved.
 */
export async function tagAudioFile(filePath: string, metadata: Metadata): Promise<void> {
    switch (extensionOf(filePath)) {
        case "flac":
            return cleanAndTagFlac(filePath, metadata);
        case "mp3":
            return tagMp3(filePath, metadata);
        case "ogg":
        case "opus":
        case "m4a":
            return tagWithFfmpeg(filePath, metadata);
        default:
            globalLogger.warn(`No tag writer for "${extensionOf(filePath)}" files; ${filePath} was left untagged`);
    }
}
