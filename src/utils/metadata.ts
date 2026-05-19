import * as fs from "fs";
import * as path from "path";
import NodeId3 from "node-id3";
import { readFlacTags, writeFlacTags, FlacTagMap, FlacTags } from "flac-tagger";
import { globalLogger } from "#base/logger/logger";

export type Metadata = {
    trackTitle: string;
    artists: string[];
    albumArtists?: string[];
    albumName?: string;
    year?: string;
    trackNumber?: string;
    isrc?: string;
    genres?: string[];
    bpm?: number;
    key?: string;
    musicBrainzTrackId?: string;
    musicBrainzAlbumId?: string;
    musicBrainzArtistId?: string;
    musicBrainzReleaseGroupId?: string;
};

export async function cleanAndTagFlac(filePath: string, metadata: Metadata) {
    // --- STEP 1: CLEAN THE FILE ---
    globalLogger.info(`--- Step 1: Cleaning invalid ID3 tags from ${filePath} ---`);
    try {
        const success = NodeId3.removeTags(filePath);
        if (success) {
            globalLogger.info("Successfully removed invalid ID3 tags. ✅");
        } else {
            globalLogger.info("File did not contain any ID3 tags to remove.");
        }
    } catch (err) {
        globalLogger.error(`Error cleaning file: ${(err as Error).message}. Stopping.`);
        return;
    }

    // --- STEP 2: WRITE FLAC METADATA ---
    globalLogger.info(`\n--- Step 2: Writing correct FLAC metadata ---`);
    try {
        const currentTags = await readFlacTags(filePath);

        const newTags: FlacTagMap = {
            ...currentTags.tagMap,
            TITLE: metadata.trackTitle,
            ARTIST: metadata.artists,
            ALBUMARTIST: metadata.albumArtists ?? metadata.artists,
            ...(metadata.albumName ? { ALBUM: metadata.albumName } : {}),
            ...(metadata.year ? { YEAR: metadata.year, DATE: metadata.year } : {}),
            ...(metadata.trackNumber ? { TRACKNUMBER: metadata.trackNumber } : {}),
            ...(metadata.isrc ? { ISRC: metadata.isrc } : {}),
            ...(metadata.genres?.length ? { GENRE: metadata.genres } : {}),
            ...(metadata.bpm != null ? { BPM: String(metadata.bpm) } : {}),
            ...(metadata.key ? { KEY: metadata.key } : {}),
            ...(metadata.musicBrainzTrackId ? { MUSICBRAINZ_TRACKID: metadata.musicBrainzTrackId } : {}),
            ...(metadata.musicBrainzAlbumId ? { MUSICBRAINZ_ALBUMID: metadata.musicBrainzAlbumId } : {}),
            ...(metadata.musicBrainzArtistId ? { MUSICBRAINZ_ARTISTID: metadata.musicBrainzArtistId } : {}),
            ...(metadata.musicBrainzReleaseGroupId
                ? { MUSICBRAINZ_RELEASEGROUPID: metadata.musicBrainzReleaseGroupId }
                : {}),
        };

        const tagsToWrite: FlacTags = {
            ...currentTags,
            tagMap: newTags,
        };

        await writeFlacTags(tagsToWrite, filePath);
        globalLogger.info("FLAC metadata updated successfully! ✅");
    } catch (error) {
        const err = error as Error & { code?: string };
        globalLogger.error(`Error writing FLAC metadata: ${err.message}`);
        if (err.message === "Invalid stream header") {
            globalLogger.error("This is unexpected, the file should be clean.");
        }
    }
}

export async function moveFile(srcPath: string, destPath: string): Promise<void> {
    await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
    try {
        await fs.promises.rename(srcPath, destPath);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "EXDEV") {
            // Cross-device / cross-partition: fall back to copy + delete
            await fs.promises.copyFile(srcPath, destPath);
            await fs.promises.unlink(srcPath);
        } else {
            throw err;
        }
    }
}
