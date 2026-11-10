import { execFile } from "child_process";
import { promisify } from "util";
import { globalLogger } from "#base/logger/logger";
import { ensureFfprobe } from "./ffprobe-setup";

const execFileAsync = promisify(execFile);

export type AudioProbeResult = {
    codec: string;
    bitrateKbps: number;
    durationMs: number;
};

interface FfprobeStream {
    codec_type?: string;
    codec_name?: string;
    bit_rate?: string;
    tags?: Record<string, string>;
}

interface FfprobeOutput {
    streams?: FfprobeStream[];
    format?: {
        bit_rate?: string;
        duration?: string;
        tags?: Record<string, string>;
    };
}

let ffprobePathPromise: Promise<string> | null = null;

function getFfprobePath(): Promise<string> {
    if (!ffprobePathPromise) {
        // A failed setup is not remembered: once the network is back the next probe tries again.
        ffprobePathPromise = ensureFfprobe().catch((error: unknown) => {
            ffprobePathPromise = null;
            throw error;
        });
    }
    return ffprobePathPromise;
}

async function runFfprobe(filePath: string): Promise<FfprobeOutput> {
    const ffprobePath = await getFfprobePath();
    const { stdout } = await execFileAsync(ffprobePath, [
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        filePath,
    ]);
    return JSON.parse(stdout) as FfprobeOutput;
}

/** ffmpeg's names for tags that the app (and the FLAC / Vorbis convention) spells differently. */
const TAG_ALIASES: Record<string, string> = { ALBUM_ARTIST: "ALBUMARTIST", TRACK: "TRACKNUMBER" };

/**
 * The tags stored in a file, as read by ffprobe: names upper-cased, in the FLAC / Vorbis-comment spelling the
 * rest of the app uses ("TITLE", "ARTIST", "TRACKNUMBER"…). This is how the tags of formats without a dedicated
 * reader (Ogg, Opus, M4A) are shown. Best-effort: `{}` on any failure.
 */
export async function probeTags(filePath: string): Promise<Record<string, string>> {
    try {
        const parsed = await runFfprobe(filePath);
        // Ogg and Opus keep their comments on the audio stream, MP4 and most others on the container.
        const audioStream = parsed.streams?.find((s) => s.codec_type === "audio");
        const raw = { ...audioStream?.tags, ...parsed.format?.tags };
        const tags: Record<string, string> = {};
        for (const [key, value] of Object.entries(raw)) {
            const upper = key.toUpperCase();
            tags[TAG_ALIASES[upper] ?? upper] = value;
        }
        return tags;
    } catch (error) {
        globalLogger.warn(`ffprobe could not read the tags of ${filePath}: ${error}`);
        return {};
    }
}

/**
 * Probe a downloaded audio file's real codec/bitrate/duration with ffprobe —
 * the ground truth, independent of the container/extension a service labeled
 * it with. Best-effort: returns null on any failure so callers can fall back
 * to metadata-derived values instead of failing the download.
 */
export async function probeAudio(filePath: string): Promise<AudioProbeResult | null> {
    try {
        const parsed = await runFfprobe(filePath);
        const audioStream = parsed.streams?.find((s) => s.codec_type === "audio");
        if (!audioStream?.codec_name) return null;

        const bitRateStr = audioStream.bit_rate ?? parsed.format?.bit_rate;
        const durationStr = parsed.format?.duration;

        return {
            codec: audioStream.codec_name,
            bitrateKbps: bitRateStr ? Math.round(Number(bitRateStr) / 1000) : 0,
            durationMs: durationStr ? Math.round(Number(durationStr) * 1000) : 0,
        };
    } catch (error) {
        globalLogger.warn(`ffprobe failed for ${filePath}: ${error}`);
        return null;
    }
}
