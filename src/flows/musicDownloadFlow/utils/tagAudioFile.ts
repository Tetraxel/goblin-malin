import * as fs from "fs";
import NodeId3 from "node-id3";
import { globalLogger } from "#base/logger/logger";
import { renameReplacing } from "#utils/dataFile";
import { albumArtistsOf, cleanAndTagFlac, dateOf, type Metadata } from "#utils/metadata";
import { runFfmpeg } from "./ffmpegRun";
import { extensionOf } from "./outputFormat";
import { addMp4Items, type Mp4Item } from "./mp4Freeform";
import { findCover, pictureArgs, pictureBlockValue } from "./embeddedPicture";

/** Several values (artists, genres) in a format with one text field per tag: shown the way the UI joins them. */
const joinValues = (values: readonly string[]) => values.join(", ");

/** The picard-compatible ID3 `TXXX` descriptions of the MusicBrainz ids that have no frame of their own. */
const ID3_MUSICBRAINZ_TEXT = {
    musicBrainzAlbumId: "MusicBrainz Album Id",
    musicBrainzArtistId: "MusicBrainz Artist Id",
    musicBrainzReleaseGroupId: "MusicBrainz Release Group Id",
    musicBrainzReleaseTrackId: "MusicBrainz Release Track Id",
} as const;

/**
 * The formats whose writers take one text per tag get the first release artist only: a list of ids glued into one
 * value would be an id nothing recognises.
 */
const firstAlbumArtistId = (metadata: Metadata) => metadata.musicBrainzAlbumArtistIds?.[0];

async function tagMp3(filePath: string, metadata: Metadata): Promise<void> {
    const userDefinedText = [
        ...(Object.keys(ID3_MUSICBRAINZ_TEXT) as (keyof typeof ID3_MUSICBRAINZ_TEXT)[])
            .filter((key) => metadata[key])
            .map((key) => ({ description: ID3_MUSICBRAINZ_TEXT[key], value: metadata[key] as string })),
        ...(firstAlbumArtistId(metadata)
            ? [{ description: "MusicBrainz Album Artist Id", value: firstAlbumArtistId(metadata)! }]
            : []),
    ];

    const dayMonth = id3DayMonth(metadata);
    const tags: NodeId3.Tags = {
        title: metadata.trackTitle,
        artist: joinValues(metadata.artists),
        performerInfo: joinValues(albumArtistsOf(metadata)),
        ...(metadata.albumName ? { album: metadata.albumName } : {}),
        ...(metadata.year ? { year: metadata.year } : {}),
        // ID3v2.3 keeps the year (TYER) and the day and month (TDAT, "DDMM") apart.
        ...(dayMonth ? { date: dayMonth } : {}),
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

/** The `DDMM` of a full release date, for ID3's TDAT frame; nothing when only the year is known. */
function id3DayMonth(metadata: Metadata): string | undefined {
    const match = metadata.date?.match(/^\d{4}-(\d{2})-(\d{2})$/);
    return match ? `${match[2]}${match[1]}` : undefined;
}

/** The tag names ffmpeg writes: Vorbis comments for Ogg / Opus, MP4 atoms for M4A. */
function ffmpegTagEntries(ext: string, metadata: Metadata): [string, string][] {
    const isMp4 = ext === "m4a";
    const entries: [string, string | undefined][] = [
        [isMp4 ? "title" : "TITLE", metadata.trackTitle],
        [isMp4 ? "artist" : "ARTIST", joinValues(metadata.artists)],
        [isMp4 ? "album_artist" : "ALBUMARTIST", joinValues(albumArtistsOf(metadata))],
        [isMp4 ? "album" : "ALBUM", metadata.albumName],
        [isMp4 ? "date" : "DATE", dateOf(metadata)],
        [isMp4 ? "track" : "TRACKNUMBER", metadata.trackNumber],
        [isMp4 ? "genre" : "GENRE", metadata.genres?.length ? joinValues(metadata.genres) : undefined],
        // The MP4 muxer has no atom for the rest, and the switch that keeps them breaks the file for other software:
        // for M4A they are added afterwards, as iTunes freeform items (see `m4aExtraItems`).
        ...(isMp4
            ? []
            : ([
                  ["ISRC", metadata.isrc],
                  ["BPM", metadata.bpm != null ? String(metadata.bpm) : undefined],
                  ["KEY", metadata.key],
                  ["MUSICBRAINZ_TRACKID", metadata.musicBrainzTrackId],
                  ["MUSICBRAINZ_ALBUMID", metadata.musicBrainzAlbumId],
                  ["MUSICBRAINZ_ARTISTID", metadata.musicBrainzArtistId],
                  ["MUSICBRAINZ_ALBUMARTISTID", firstAlbumArtistId(metadata)],
                  ["MUSICBRAINZ_RELEASEGROUPID", metadata.musicBrainzReleaseGroupId],
                  ["MUSICBRAINZ_RELEASETRACKID", metadata.musicBrainzReleaseTrackId],
              ] as [string, string | undefined][])),
    ];
    return entries.filter((e): e is [string, string] => e[1] !== undefined && e[1] !== "");
}

/**
 * What M4A files carry beyond ffmpeg's standard atoms, under the names MusicBrainz Picard writes (the ones other
 * software looks for). The tempo goes in the `tmpo` atom, apart from these.
 */
function m4aExtraItems(metadata: Metadata): Mp4Item[] {
    const items: [string, string | undefined][] = [
        ["ISRC", metadata.isrc],
        ["initialkey", metadata.key],
        ["MusicBrainz Track Id", metadata.musicBrainzTrackId],
        ["MusicBrainz Album Id", metadata.musicBrainzAlbumId],
        ["MusicBrainz Artist Id", metadata.musicBrainzArtistId],
        ["MusicBrainz Album Artist Id", firstAlbumArtistId(metadata)],
        ["MusicBrainz Release Group Id", metadata.musicBrainzReleaseGroupId],
        ["MusicBrainz Release Track Id", metadata.musicBrainzReleaseTrackId],
    ];
    return items.filter((i): i is [string, string] => Boolean(i[1])).map(([name, value]) => ({ name, value }));
}

/**
 * Rewrites the tags of an Ogg, Opus or M4A file by remuxing it (`-c copy`: the audio is not touched). The tags the
 * file had are replaced by the app's own set, not merged with it: for these formats the file comes from the app's
 * conversion or from yt-dlp, whose leftovers (comment, URL…) are not worth keeping. The cover art is not a tag: a
 * picture the file carries is put back (when that fails, the file is tagged without it rather than not at all).
 */
async function tagWithFfmpeg(filePath: string, metadata: Metadata): Promise<void> {
    const ext = extensionOf(filePath);
    // Not an audio extension: a leftover from a crash must not look like a track in the library. ffmpeg can no
    // longer guess the container from the name, so it is given explicitly.
    const rewritten = `${filePath}.tagging`;
    const cover = await findCover(filePath);

    const remux = async (keepCover: boolean) => {
        let pictureCleanup: (() => Promise<void>) | undefined;
        const coverArgs: string[] = [];
        let mapArgs = ["-map", "0:a"];
        if (keepCover && cover) {
            if (ext === "m4a" && cover.kind === "stream") {
                // An attached picture, kept as one: the MP4 muxer writes it as the `covr` atom.
                mapArgs = ["-map", "0:a", "-map", "0:v:0"];
                coverArgs.push("-disposition:v:0", "attached_pic");
            } else if (ext !== "m4a") {
                const value = await pictureBlockValue(filePath, cover);
                if (value) {
                    const picture = await pictureArgs(value);
                    coverArgs.push(...picture.args);
                    pictureCleanup = picture.cleanup;
                }
            }
        }
        const args = [
            "-i",
            filePath,
            "-f",
            ext === "m4a" ? "ipod" : ext,
            ...mapArgs,
            "-c",
            "copy",
            // Start from no tags, container-wide and on the audio stream: Ogg / Opus keep their comments on the stream,
            // and where both exist the old stream value would win over the new one.
            "-map_metadata",
            "-1",
            "-map_metadata:s:a",
            "-1",
            ...ffmpegTagEntries(ext, metadata).flatMap(([key, value]) => ["-metadata", `${key}=${value}`]),
            ...coverArgs,
            rewritten,
        ];
        try {
            await runFfmpeg(args);
        } finally {
            await pictureCleanup?.();
        }
    };

    try {
        try {
            await remux(true);
        } catch (error) {
            if (!cover) throw error;
            globalLogger.warn(
                `${filePath}: the cover art could not be kept (${(error as Error).message}); tagging without it`
            );
            await remux(false);
        }
        if (ext === "m4a") {
            const bpm = metadata.bpm ?? undefined;
            if (!(await addMp4Items(rewritten, m4aExtraItems(metadata), bpm))) {
                globalLogger.warn(
                    `${filePath}: the MP4 layout is not one the extra tags can be added to; standard tags only`
                );
            }
        }
        // Retries when an antivirus or an indexer briefly holds the file (Windows), like every other replacing rename.
        await renameReplacing(rewritten, filePath);
    } catch (error) {
        await fs.promises.rm(rewritten, { force: true });
        throw error;
    }
    globalLogger.info(`${ext.toUpperCase()} metadata updated successfully! ✅`);
}

/**
 * Writes `metadata` into a saved file, in the tag system its format uses: Vorbis comments for FLAC, Ogg and
 * Opus, ID3 for MP3, MP4 atoms for M4A. A failure is thrown (for every format), so the save is reported as
 * failed instead of leaving an untagged file that looks saved.
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
