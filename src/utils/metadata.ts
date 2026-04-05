import * as fs from 'fs';
import * as path from 'path';
import { removeTags } from 'node-id3';
import { readFlacTags, writeFlacTags, FlacTagMap, FlacTags } from 'flac-tagger';
import logger from './logger';

type Metadata = {
    trackTitle: string;
    artistName: string;
    albumName?: string;
    trackNumber?: string;
    year?: string;
}

/**
 * Cleans invalid ID3 tags from a file and then writes
 * proper FLAC (Vorbis Comment) metadata.
 * * @param filePath The path to the FLAC file.
 */
export async function cleanAndTagFlac(filePath: string, metadata: Metadata) {

    // --- STEP 1: CLEAN THE FILE ---
    globalLogger.info(`--- Step 1: Cleaning invalid ID3 tags from ${filePath} ---`);
    try {
        const success = await removeTags(filePath);
        if (success) {
            globalLogger.info('Successfully removed invalid ID3 tags. ✅');
        } else {
            // This is also fine, means the file was already clean
            globalLogger.info('File did not contain any ID3 tags to remove.');
        }
    } catch (err: Error | any) {
        globalLogger.error(`Error cleaning file: ${err.message}. Stopping.`);
        return; // Stop if cleaning fails
    }

    // --- STEP 2: WRITE FLAC METADATA ---
    globalLogger.info(`\n--- Step 2: Writing correct FLAC metadata ---`);
    try {
        // 1. Read the now-clean file
        const currentTags = await readFlacTags(filePath);

        // 2. Define your new tags
        const newTags: FlacTagMap = {
            ...currentTags.tagMap, // Keep all existing *correct* tags
            TITLE: metadata.trackTitle,
            ARTIST: [metadata.artistName],
            ALBUMARTIST: metadata.artistName,
            ...(metadata.albumName ? { ALBUM: metadata.albumName } : {}),
            ...(metadata.year ? { YEAR: metadata.year } : {}),
            ...(metadata.year ? { DATE: metadata.year } : {}),
            ...(metadata.trackNumber ? { TRACKNUMBER: metadata.trackNumber } : {}),
        }

        // 3. Prepare the full tags object to write
        //    This object includes all metadata blocks, not just the tags
        const tagsToWrite: FlacTags = {
            ...currentTags, // IMPORTANT: This keeps all other metadata blocks
            tagMap: newTags, // This provides the updated tags
        };

        // 3. Write the tags back
        await writeFlacTags(tagsToWrite, filePath);

        globalLogger.info('FLAC metadata updated successfully! ✅');

    } catch (error) {
        const err = error as Error & { code?: string };
        globalLogger.error(`Error writing FLAC metadata: ${err.message}`);
        if (err.message === 'Invalid stream header') {
            globalLogger.error('This is unexpected, the file should be clean.');
        }
    }
}

/**
 * Securely renames a file, ensuring it exists and is not moved to a different directory.
 *
 * @param oldPath The current path of the file.
 * @param newPath The new path for the file.
 * @throws Error if the old file does not exist.
 * @throws Error if the new path is in a different directory.
 * @throws Error if the rename operation fails for other reasons.
 */
export function renameFile(oldPath: string, newPath: string): void {
    globalLogger.info(`Attempting to rename '${oldPath}' to '${newPath}'…`);

    try {
        // 1. Check if the original file exists
        if (!fs.existsSync(oldPath)) {
            throw new Error(`File does not exist at path: ${oldPath}`);
        }

        // 2. Resolve absolute paths to prevent relative path trickery
        const absoluteOldPath = path.resolve(oldPath);
        const absoluteNewPath = path.resolve(newPath);

        // 3. Get the directory names for both paths
        const oldDir = path.dirname(absoluteOldPath);
        const newDir = path.dirname(absoluteNewPath);

        // 4. Prevent moving the file to a different directory
        if (oldDir !== newDir) {
            throw new Error(
                `File move detected. Renaming is only allowed within the same directory.
         Source Directory: ${oldDir}
         Target Directory: ${newDir}`
            );
        }

        // 5. Check if the new file name already exists (optional but good practice)
        if (fs.existsSync(absoluteNewPath)) {
            throw new Error(`A file already exists at the new path: ${absoluteNewPath}`);
        }

        // 6. Perform the rename operation
        fs.renameSync(absoluteOldPath, absoluteNewPath);
        globalLogger.info(`Successfully renamed '${oldPath}' to '${newPath}'.`);

    } catch (error) {
        globalLogger.error('File rename failed:');
        if (error instanceof Error) {
            globalLogger.error(error.message);
        } else {
            globalLogger.error('An unknown error occurred:', error);
        }
    }
}