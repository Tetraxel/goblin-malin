import { spawn } from "child_process";
import fs from "fs/promises";
import { killProcessTree } from "#utils/killProcessTree";
import { registerAgentCleanup } from "#base/agent/cleanup";
import { globalLogger } from "#base/logger/logger";
import { getFfmpegPath } from "./ffmpegRun";

/**
 * The shape of an audio file, for drawing it (P33's stem layers): `WAVEFORM_BUCKETS` loudness values from 0 to 1, one per
 * slice of the file. ffmpeg decodes the file to a small mono signal (2 kHz is plenty to see the
 * loudness), read from its output: nothing is written to disk. About half a second for a 4-minute FLAC.
 */
export const WAVEFORM_BUCKETS = 400;
const SAMPLE_RATE = 2000;
/** Waveforms kept in memory (by file, size and date): a few tracks' layers. */
const CACHE_SIZE = 40;

const cache = new Map<string, Promise<number[] | null>>();
/** One ffmpeg at a time: five layers open together, and the screen must keep painting. */
let queue: Promise<unknown> = Promise.resolve();

/**
 * The loudness (RMS) of each of `buckets` equal slices of `samples` (16-bit), scaled so the loudest slice is 1. RMS
 * rather than the loudest sample: a mastered track peaks near the top almost everywhere, and would draw as a flat bar.
 */
export function peaksOf(samples: Int16Array, buckets: number): number[] {
    const levels = new Array<number>(buckets).fill(0);
    if (samples.length === 0) return levels;
    for (let b = 0; b < buckets; b++) {
        const from = Math.floor((b * samples.length) / buckets);
        const to = Math.min(samples.length, Math.max(from + 1, Math.floor(((b + 1) * samples.length) / buckets)));
        let sum = 0;
        for (let i = from; i < to; i++) sum += samples[i] * samples[i];
        levels[b] = Math.sqrt(sum / Math.max(1, to - from));
    }
    const loudest = Math.max(1e-9, ...levels);
    return levels.map((level) => level / loudest);
}

function decode(filePath: string): Promise<number[]> {
    return getFfmpegPath().then(
        (ffmpeg) =>
            new Promise<number[]>((resolve, reject) => {
                const child = spawn(
                    ffmpeg,
                    ["-hide_banner", "-nostdin", "-loglevel", "error", "-i", filePath, "-vn", "-ac", "1"].concat([
                        "-ar",
                        String(SAMPLE_RATE),
                        "-f",
                        "s16le",
                        "-acodec",
                        "pcm_s16le",
                        "-",
                    ]),
                    { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
                );
                const forget = registerAgentCleanup(() => killProcessTree(child));
                const chunks: Buffer[] = [];
                let stderr = "";
                child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
                child.stderr.on("data", (chunk: Buffer) => (stderr = (stderr + chunk.toString()).slice(-400)));
                child.on("error", (error) => {
                    forget();
                    reject(error);
                });
                child.on("close", (code) => {
                    forget();
                    if (code !== 0) return reject(new Error(`ffmpeg could not read ${filePath}: ${stderr.trim()}`));
                    const data = Buffer.concat(chunks);
                    const samples = new Int16Array(data.buffer, data.byteOffset, Math.floor(data.length / 2));
                    resolve(peaksOf(samples, WAVEFORM_BUCKETS));
                });
            })
    );
}

/** The waveform of a file, or `null` when it cannot be read (gone, not audio). Cached; never throws. */
export async function loadWaveform(filePath: string): Promise<number[] | null> {
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat) return null;
    const key = `${filePath}|${stat.size}|${Math.round(stat.mtimeMs)}`;
    let pending = cache.get(key);
    if (!pending) {
        pending = queue.then(() =>
            decode(filePath).catch((error: unknown) => {
                globalLogger.debug(`No waveform for ${filePath}`, { error });
                return null;
            })
        );
        queue = pending;
        cache.set(key, pending);
        while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string);
    }
    return pending;
}
