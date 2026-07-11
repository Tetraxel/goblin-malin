import { stat } from "fs/promises";
import * as path from "path";
import { readFlacTags } from "flac-tagger";
import NodeID3 from "node-id3";
import { FileInfo, Provenance } from "#flows/musicDownloadFlow/types";
import { probeAudio } from "#utils/probeAudio";

const ID3_TAG_MAP: Record<string, string | undefined> = {
    title: "TITLE",
    artist: "ARTIST",
    album: "ALBUM",
    year: "DATE",
    trackNumber: "TRACKNUMBER",
    ISRC: "ISRC",
    bpm: "BPM",
    initialKey: "KEY",
};

// node-id3's Tags shape doesn't match flac-tagger's uppercase Vorbis-comment-style
// tagMap — normalize the handful of fields the UI actually displays (PRIORITY_TAGS
// in DownloadSourceDetail) into the same shape so both formats render identically.
function normalizeId3Tags(tags: NodeID3.Tags): Record<string, string | string[]> {
    const embeddedTags: Record<string, string | string[]> = {};
    for (const [id3Key, mappedKey] of Object.entries(ID3_TAG_MAP)) {
        const value = tags[id3Key as keyof NodeID3.Tags];
        if (typeof value === "string" && mappedKey) {
            embeddedTags[mappedKey] = value;
        }
    }
    return embeddedTags;
}

async function readTags(filePath: string, format: "flac" | "mp3"): Promise<Record<string, string | string[]>> {
    if (format === "flac") {
        const flacData = await readFlacTags(filePath);
        return flacData.tagMap ?? {};
    }
    const tags = await NodeID3.Promise.read(filePath);
    return normalizeId3Tags(tags);
}

/**
 * Read a downloaded file's size/duration/tags, plus its real codec/bitrate via
 * ffprobe (ground truth, independent of container/extension). `provenance` is
 * supplied by the caller, not derived from the probe — it depends on which
 * service produced the file (e.g. yt-dlp's FLAC container always wraps a lossy
 * Opus source, which no amount of probing the resulting file can detect).
 */
export async function readFileInfo(
    filePath: string,
    fallbackDurationMs: number,
    provenance: Provenance,
    sourceCodec?: string
): Promise<FileInfo> {
    const format = path.extname(filePath).slice(1).toLowerCase() as "flac" | "mp3";

    const [stats, embeddedTags, probeResult] = await Promise.all([
        stat(filePath),
        readTags(filePath, format),
        probeAudio(filePath),
    ]);

    return {
        format,
        sizeBytes: stats.size,
        durationMs: probeResult?.durationMs || fallbackDurationMs,
        embeddedTags,
        codec: probeResult?.codec,
        bitrateKbps: probeResult?.bitrateKbps,
        provenance,
        sourceCodec,
    };
}
