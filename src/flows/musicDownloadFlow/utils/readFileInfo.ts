import { stat } from "fs/promises";
import { readFlacTags } from "flac-tagger";
import { FileInfo } from "#flows/musicDownloadFlow/types";

// Read file and return a FileInfo object
export async function readFileInfo(filePath: string, fallbackDurationMs: number): Promise<FileInfo> {
    const [stats, flacData] = await Promise.all([stat(filePath), readFlacTags(filePath)]);
    return {
        format: "flac",
        sizeBytes: stats.size,
        durationMs: fallbackDurationMs,
        embeddedTags: flacData.tagMap ?? {},
    };
}
