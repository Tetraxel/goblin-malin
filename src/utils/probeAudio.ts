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
}

interface FfprobeOutput {
    streams?: FfprobeStream[];
    format?: {
        bit_rate?: string;
        duration?: string;
    };
}

let ffprobePathPromise: Promise<string> | null = null;

function getFfprobePath(): Promise<string> {
    if (!ffprobePathPromise) {
        ffprobePathPromise = ensureFfprobe();
    }
    return ffprobePathPromise;
}

/**
 * Probe a downloaded audio file's real codec/bitrate/duration with ffprobe —
 * the ground truth, independent of the container/extension a service labeled
 * it with. Best-effort: returns null on any failure so callers can fall back
 * to metadata-derived values instead of failing the download.
 */
export async function probeAudio(filePath: string): Promise<AudioProbeResult | null> {
    try {
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

        const parsed = JSON.parse(stdout) as FfprobeOutput;
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
