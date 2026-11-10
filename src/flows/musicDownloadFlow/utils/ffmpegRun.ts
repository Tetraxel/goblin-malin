import { execFile } from "child_process";
import { promisify } from "util";
import { makeAbortError } from "#utils/errors";
import { ensureFfmpeg } from "#utils/ffmpeg-setup";
import { getDownloadProviderSettings } from "../saveSettings";

const execFileAsync = promisify(execFile);

/** The last lines of ffmpeg's error output are the ones that say what went wrong. */
const STDERR_TAIL_CHARS = 600;

let ffmpegPathPromise: Promise<string> | null = null;

function getFfmpegPath(): Promise<string> {
    if (!ffmpegPathPromise) {
        // Same rule as the yt-dlp download: binaries are only updated when the user left that on, and a missing
        // one is always downloaded. A failed setup is not remembered, so the next conversion tries again.
        const autoDownload = getDownloadProviderSettings("ytdlp").autoDownloadBinary !== false;
        ffmpegPathPromise = ensureFfmpeg(autoDownload).catch((error: unknown) => {
            ffmpegPathPromise = null;
            throw error;
        });
    }
    return ffmpegPathPromise;
}

/**
 * Runs the downloaded ffmpeg with `args` (no shell, so file names need no quoting) and resolves once it exits
 * with 0. Aborting `signal` kills it and rejects with an `AbortError`; any other failure rejects with the tail of
 * ffmpeg's own message.
 */
export async function runFfmpeg(args: readonly string[], signal?: AbortSignal): Promise<void> {
    const ffmpeg = await getFfmpegPath();
    try {
        await execFileAsync(ffmpeg, ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", ...args], {
            signal,
            windowsHide: true,
            maxBuffer: 16 * 1024 * 1024,
        });
    } catch (error) {
        if (signal?.aborted) throw makeAbortError();
        const stderr = (error as { stderr?: string }).stderr?.trim();
        const reason = stderr ? stderr.slice(-STDERR_TAIL_CHARS) : (error as Error).message;
        throw new Error(`ffmpeg failed: ${reason}`);
    }
}
