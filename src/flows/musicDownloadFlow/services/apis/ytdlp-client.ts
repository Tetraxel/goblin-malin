import { YtDlp } from "ytdlp-nodejs";
import { ProviderUnavailableError } from "#base/providerUnavailableError";
import { ensureFfmpeg } from "#utils/ffmpeg-setup";
import { Semaphore } from "#utils/semaphore";
import { throwIfAborted, untilAborted } from "#utils/errors";
import { withTimeout } from "#utils/withTimeout";
import { ensureYtDlpSetup } from "../download-providers/ytdlp/ytdlp-setup";
import { getDownloadProviderSettings } from "../../saveSettings";

/** How long a failed set-up is remembered, so a wave of searches does not retry it (and re-alert) once per track. */
const SETUP_FAILURE_COOLDOWN_MS = 30_000;

/**
 * A set-up done once and shared, whose failure is remembered for `SETUP_FAILURE_COOLDOWN_MS` and then retried. A
 * failed set-up (offline, the user dismissed the alert) must not stick for good: after the cooldown the next call
 * tries again.
 */
function sharedSetup<T>(setUp: () => Promise<T>): (options?: { retryNow?: boolean }) => Promise<T> {
    let promise: Promise<T> | undefined;
    let lastFailure: { error: unknown; at: number } | undefined;
    return (options = {}) => {
        if (!promise) {
            if (!options.retryNow && lastFailure && Date.now() - lastFailure.at < SETUP_FAILURE_COOLDOWN_MS) {
                return Promise.reject(lastFailure.error);
            }
            promise = setUp().then(
                (value) => {
                    lastFailure = undefined;
                    return value;
                },
                (error) => {
                    promise = undefined;
                    lastFailure = { error, at: Date.now() };
                    throw error;
                }
            );
        }
        return promise;
    };
}

/** Only update the binaries to the latest release when the user opted in; an absent binary is always downloaded. */
function autoDownloadBinary(): boolean {
    return getDownloadProviderSettings("ytdlp").autoDownloadBinary !== false;
}

/** The yt-dlp binary, set up once for the whole app (downloads and page reads share it). */
const getYtDlpBinary = sharedSetup(() => ensureYtDlpSetup(autoDownloadBinary()));

/**
 * The one yt-dlp client of the app that downloads (`YtDlpService`): the binary and ffmpeg, set up once and shared,
 * not repeated per task.
 *
 * @param options.retryNow Ignore a recent failed set-up and try again. A download the user asked for does; a metadata
 *   search done in the background for every track of a playlist does not.
 */
export const getYtDlpClient = (() => {
    const setUp = sharedSetup(async () => {
        const binaryPath = await getYtDlpBinary({ retryNow: true });
        const ffmpegPath = await ensureFfmpeg(autoDownloadBinary());
        return new YtDlp({ binaryPath, ffmpegPath });
    });
    return (options: { retryNow?: boolean } = {}): Promise<YtDlp> => setUp(options);
})();

/**
 * The client that reads a page's JSON (SoundCloud): the binary only. `--dump-single-json` never needs ffmpeg, so a
 * page read must not pull the ffmpeg archive (~340 MB unpacked) onto the disk.
 */
const getYtDlpReader = sharedSetup(async () => new YtDlp({ binaryPath: await getYtDlpBinary() }));

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

/** Thrown by `readYtDlpInfo` when the user has yt-dlp switched off: nothing is set up or run. */
export class YtDlpDisabledError extends ProviderUnavailableError {
    constructor(what: string) {
        super(`${what} is read through yt-dlp, which is switched off (Settings → Download)`);
        this.name = "YtDlpDisabledError";
    }
}

/**
 * yt-dlp's JSON for a page, or for a search (`scsearch8:…`, a flat listing). Runs within a small process budget, and a
 * process that has not answered in `timeoutMs`, or whose caller gave up (`signal`), is killed, not just abandoned.
 * Refuses with `YtDlpDisabledError` when yt-dlp is switched off: reading a page would download the binary for a user
 * who chose not to use it.
 */
export function readYtDlpInfo<T>(
    url: string,
    options: { timeoutMs: number; timeoutMessage: string; site: string; signal?: AbortSignal }
): Promise<T> {
    if (!isYtDlpEnabled()) return Promise.reject(new YtDlpDisabledError(options.site));
    const { signal } = options;
    return infoLimiter.run(async () => {
        throwIfAborted(signal);
        const client = await getYtDlpReader();
        throwIfAborted(signal);
        // `ignoreConfig`: a user's own yt-dlp.conf (`--print`, `-o`, `--no-flat-playlist`…) would change the JSON these
        // runs print. `ignoreNoFormatsError`: a DRM-protected or preview-only track (SoundCloud Go+) has public
        // metadata but no downloadable format, and yt-dlp would exit with an error instead of printing the JSON.
        // Reading a page's metadata must not depend on being able to download it; the download stage fails on its
        // own if it cannot.
        const run = client.exec(url, {
            dumpSingleJson: true,
            flatPlaylist: true,
            ignoreNoFormatsError: true,
            ignoreConfig: true,
        });
        const onAbort = () => run.kill();
        signal?.addEventListener("abort", onAbort, { once: true });
        try {
            const result = await untilAborted(
                withTimeout(run.run(), options.timeoutMs, options.timeoutMessage),
                signal
            );
            return JSON.parse(result.output) as T;
        } catch (error) {
            run.kill();
            throw error;
        } finally {
            signal?.removeEventListener("abort", onAbort);
        }
    });
}
