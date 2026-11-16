import { YtDlp } from "ytdlp-nodejs";
import { ensureFfmpeg } from "#utils/ffmpeg-setup";
import { Semaphore } from "#utils/semaphore";
import { withTimeout } from "#utils/withTimeout";
import { ensureYtDlpSetup } from "../download-providers/ytdlp/ytdlp-setup";
import { getDownloadProviderSettings } from "../../saveSettings";

/**
 * The one yt-dlp client of the app. The download service (`YtDlpService`) downloads with it, and a metadata service
 * that reads a site through yt-dlp's extractors (SoundCloud) asks it for a page's JSON: both want the same binary,
 * set up once, so the set-up is shared and not repeated per task.
 */
let clientPromise: Promise<YtDlp> | undefined;

/** How long a failed set-up is remembered, so a wave of searches does not retry it (and re-alert) once per track. */
const SETUP_FAILURE_COOLDOWN_MS = 30_000;
let lastFailure: { error: unknown; at: number } | undefined;

/**
 * @param options.retryNow Ignore a recent failed set-up and try again. A download the user asked for does; a metadata
 *   search done in the background for every track of a playlist does not.
 */
export function getYtDlpClient(options: { retryNow?: boolean } = {}): Promise<YtDlp> {
    if (!clientPromise) {
        if (!options.retryNow && lastFailure && Date.now() - lastFailure.at < SETUP_FAILURE_COOLDOWN_MS) {
            return Promise.reject(lastFailure.error);
        }
        clientPromise = (async () => {
            // Only update the binaries to the latest release when the user opted in; an absent binary is always
            // downloaded regardless.
            const autoDownloadBinary = getDownloadProviderSettings("ytdlp").autoDownloadBinary !== false;
            const binaryPath = await ensureYtDlpSetup(autoDownloadBinary);
            const ffmpegPath = await ensureFfmpeg(autoDownloadBinary);
            return new YtDlp({ binaryPath, ffmpegPath });
        })().then(
            (client) => {
                lastFailure = undefined;
                return client;
            },
            (error) => {
                // A failed set-up (offline, the user dismissed the alert) must not stick for good: after the
                // cooldown the next call tries again.
                clientPromise = undefined;
                lastFailure = { error, at: Date.now() };
                throw error;
            }
        );
    }
    return clientPromise;
}

/**
 * Whether the user has the yt-dlp provider switched on. Reading a site through yt-dlp makes the app download yt-dlp
 * and ffmpeg when they are missing: not something to do for a user who turned yt-dlp off (a Soulseek-only setup), and
 * a track found that way could not be downloaded anyway.
 */
export function isYtDlpEnabled(): boolean {
    return getDownloadProviderSettings("ytdlp").enabled !== false;
}

/** At most this many yt-dlp processes reading a page at once (each is a whole Python-sized process to start). */
const INFO_CONCURRENCY = 3;
const infoLimiter = new Semaphore(INFO_CONCURRENCY);

/**
 * yt-dlp's JSON for a page, or for a search (`scsearch8:…`, a flat listing). Runs within a small process budget, and a
 * process that has not answered in `timeoutMs` is killed, not just abandoned.
 */
export function readYtDlpInfo<T>(url: string, options: { timeoutMs: number; timeoutMessage: string }): Promise<T> {
    return infoLimiter.run(async () => {
        const client = await getYtDlpClient();
        const run = client.exec(url, { dumpSingleJson: true, flatPlaylist: true });
        try {
            const result = await withTimeout(run.run(), options.timeoutMs, options.timeoutMessage);
            return JSON.parse(result.output) as T;
        } catch (error) {
            run.kill();
            throw error;
        }
    });
}
