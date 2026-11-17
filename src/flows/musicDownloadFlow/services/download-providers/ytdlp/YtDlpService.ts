import fs from "fs";
import path from "path";
import { type FormatOptions, type QualityOptions, type YtDlp } from "ytdlp-nodejs";
import stripAnsi from "strip-ansi";
import { DownloadService, type DownloadUpdateCallback } from "../../../downloadService";
import { type ProviderDisplay } from "#base/providerDisplay";
import { type ProviderSettingsSchema } from "#base/providerSettings";
import { StatusType } from "#base/task/task-status";
import { type Logger } from "#base/logger/logger";
import { platformRegistry } from "#base/platformRegistry";
import { getBinDir } from "#utils/appPaths";
import { makeAbortError } from "#utils/errors";
import { killProcessTree } from "#utils/killProcessTree";
import {
    type APIProvider,
    type TrackMetadata,
    type TrackDownloadSource,
    type DownloadProgressInfo,
    type DownloadQueryField,
    type LocalFile,
    type FileInfo,
} from "#flows/musicDownloadFlow/types";
import { type DownloadTask } from "#flows/musicDownloadFlow/utils/downloadTask";
import { readFileInfo } from "#flows/musicDownloadFlow/utils/readFileInfo";
import { copyCookiesForRun, type CookiesCopy } from "./cookiesCopy";
import { COOKIE_BROWSERS, cookiesBrowserFrom, cookiesSettingsRows, cookiesSettingsStatus } from "./cookiesSettings";
import { explainYtDlpFailure } from "./explainError";
import { YtDlpCell } from "./YtDlpCell";
import { getYtDlpClient } from "../../apis/ytdlp-client";
import { getTempDownloadDir, getSaveSettings, getDownloadProviderSettings } from "../../../saveSettings";
import { generateTempStem, findExistingTempFile, listTempFilesWithStem } from "#flows/musicDownloadFlow/utils/tempFile";
import { extensionOf, parseOutputFormat } from "#flows/musicDownloadFlow/utils/outputFormat";

/**
 * The audio files a yt-dlp download can end up as: its own FLAC, or the codec YouTube serves, which yt-dlp
 * extracts as-is (Opus → .opus, Vorbis → .ogg, AAC → .m4a, MP3 → .mp3). Never an intermediate `.webm` / `.part`.
 */
const YTDLP_AUDIO_EXTENSIONS = ["flac", "opus", "m4a", "ogg", "mp3"] as const;

/**
 * What a "track" may be. yt-dlp is told to skip anything bigger or longer (and any live stream), so a link to a
 * ten-hour video or a stream that never ends cannot fill the disk. Both skips make yt-dlp exit successfully
 * without a file, which the download then reports.
 */
const MAX_TRACK_FILESIZE = "500M";
const MAX_TRACK_SECONDS = 3 * 60 * 60;
/** `?` lets a video with no known duration through: the size limit still applies to it. */
const TRACK_MATCH_FILTER = `!is_live & duration<=?${MAX_TRACK_SECONDS}`;

/** Whether `file` is the finished download named `<stem>.<audio extension>` (and not a leftover like `<stem>.f251.webm`). */
function isFinishedAudioFile(file: string, stem: string): boolean {
    const rest = path.basename(file).slice(stem.length + 1);
    return (YTDLP_AUDIO_EXTENSIONS as readonly string[]).includes(rest);
}

export class YtDlpService extends DownloadService {
    static readonly display: ProviderDisplay = {
        label: "YtDlp",
        acronym: "YTDLP",
        color: "#ff0033",
        colorSubtle: "#7a1500",
        colorBright: "#ff4040",
    };
    static readonly defaultSettings: ProviderSettingsSchema = {
        enabled: { label: "Enable", defaultValue: true, kind: "checkbox" },
        autoDownloadBinary: { label: "Auto-download latest binaries", defaultValue: true, kind: "checkbox" },
        // YouTube asks a client with no session to sign in ("confirm you're not a bot"): the cookies of a signed-in
        // browser, read by yt-dlp itself, are the quickest way past it (the other is an imported cookies.txt, below).
        cookiesBrowser: {
            label: "Cookies from browser (off: use the imported cookies.txt)",
            defaultValue: "off",
            kind: "select",
            options: COOKIE_BROWSERS,
        },
    };
    static readonly settingsRows = cookiesSettingsRows;
    static readonly settingsStatus = cookiesSettingsStatus;
    static readonly cellComponent = YtDlpCell;

    public compatibleMetadataProviders: APIProvider[] = ["youtube", "soundcloud"];

    constructor(task: DownloadTask, logger: Logger) {
        super("YtDlpService", task, logger);
    }

    /** The app's shared yt-dlp (the metadata services that read a site through yt-dlp use the same one). */
    private getClient(): Promise<YtDlp> {
        // A download the user asked for tries the set-up again even right after a failed one.
        return getYtDlpClient({ retryNow: true });
    }

    async downloadTrack(
        trackMetadata: TrackMetadata,
        onUpdate?: DownloadUpdateCallback,
        signal?: AbortSignal
    ): Promise<TrackDownloadSource> {
        // Check if this service can handle the track's source
        if (!this.canDownload(trackMetadata)) {
            throw new Error(
                `YtDlpService cannot download from ${trackMetadata.apiProvider}. Compatible providers: ${this.compatibleMetadataProviders.join(", ")}`
            );
        }

        const trackUrl = trackMetadata.url;

        // A dedicated controller so the row can be cancelled on its own (e.g. the
        // user rejects it mid-download) without needing the task-level `signal` —
        // linked to it so a real task-level abort still cascades down here too.
        // Stopped before it began: no row, nothing to clean (the event below never fires for a signal already aborted).
        if (signal?.aborted) throw makeAbortError();
        const rowAbortController = new AbortController();
        const onOuterAbort = () => rowAbortController.abort();
        signal?.addEventListener("abort", onOuterAbort, { once: true });
        const reportAbort = () => rowAbortController.abort();

        // In-progress source emitted right away so the UI shows the download before it completes.
        const startedAt = Date.now();
        // yt-dlp isn't searching: it is handed the track's page URL and nothing else.
        const query: DownloadQueryField[] = [{ label: "URL", value: trackUrl }];
        const pendingSource: TrackDownloadSource = {
            state: "downloading",
            provider: "ytdlp",
            track: trackMetadata,
            downloadedAt: new Date(),
            selected: false,
            progress: 0,
            progressInfo: { startedAt },
            query,
        };
        onUpdate?.(pendingSource, { abort: reportAbort });

        // What the detail panel shows under the progress bar: live stats plus this service's own
        // output (plain lines - the Logs tab has the prefixed version of the same messages).
        const MAX_LOG_LINES = 100;
        const log: string[] = [];
        let stats: Omit<DownloadProgressInfo, "startedAt" | "log"> = {};
        let percent = 0;
        const publish = (state: "downloading" | "failed" = "downloading") =>
            onUpdate?.(
                { ...pendingSource, state, progress: percent, progressInfo: { startedAt, ...stats, log: [...log] } },
                state === "downloading" ? { abort: reportAbort } : undefined
            );
        const note = (line: string, level: "info" | "debug" | "warn" = "info") => {
            this.logger[level](line);
            log.push(line);
            if (log.length > MAX_LOG_LINES) log.shift();
            publish();
        };

        // This run's private copy of cookies.txt, if there is one; removed whatever way the run ends.
        let cookiesCopy: CookiesCopy | undefined;
        // The name of the files this run is making, once it has started making them (see the clean-up on failure).
        let runStem: string | undefined;
        try {
            note(`Downloading track from ${trackMetadata.apiProvider}: ${trackMetadata.trackName}`);
            this.status.set({
                type: StatusType.Processing,
                message: `Downloading ${trackMetadata.trackName}`,
                timeTracking: true,
                progress: 0,
            });

            // yt-dlp converts to FLAC itself only when that is what every download is converted to anyway (the
            // default). Otherwise it keeps YouTube's own codec (Opus / AAC) and saving converts it - once, and
            // only if the settings ask for it - so the temporary file is the honest source, not a lossy FLAC.
            const saveSettings = getSaveSettings();
            const nativeFlac = saveSettings.convertAudio && parseOutputFormat(saveSettings.convertFormat) === "flac";
            const format = nativeFlac ? "flac" : "best";
            const artistName = trackMetadata.artists?.[0]?.name ?? "Unknown Artist";
            const outputName = `${artistName} - ${trackMetadata.trackName}`;

            // A finished download in any audio format is reused: saving converts it to the wanted one.
            const existingPath = await findExistingTempFile(
                YtDlpService.display.label,
                trackMetadata,
                YTDLP_AUDIO_EXTENSIONS,
                getTempDownloadDir()
            );
            // `<provider> <id> <uuid>`; the extension is added by yt-dlp when the format is not forced.
            const tempStem = existingPath
                ? path.basename(existingPath, path.extname(existingPath))
                : generateTempStem(YtDlpService.display.label, trackMetadata);
            // Where the finished file is. Known up front only when the format is forced; otherwise found after the run.
            let fullPath = existingPath ?? path.join(getTempDownloadDir(), `${tempStem}.flac`);

            // Check if file already exists
            let localFile: LocalFile;
            if (existingPath) {
                note(`File already exists, skipping download: ${path.basename(fullPath)}`);
                localFile = {
                    state: "found",
                    path: fullPath,
                    name: outputName,
                    extension: extensionOf(fullPath) as LocalFile["extension"],
                    sourceUrl: trackUrl,
                };
            } else {
                runStem = tempStem;
                // Ensure download directory exists
                await fs.promises.mkdir(getTempDownloadDir(), { recursive: true });

                // Load cookies if available
                const cookiesPath = path.join(getBinDir(), "cookies.txt");
                const downloadOptions: FormatOptions<keyof QualityOptions> = {
                    paths: getTempDownloadDir(),
                    // `%` is yt-dlp's template escape: a literal one in a track name must be doubled. With "best"
                    // the extension is left to yt-dlp (`%(ext)s`), which names the file after the codec it kept.
                    output: `${tempStem.replace(/%/g, "%%")}.${nativeFlac ? "flac" : "%(ext)s"}`,
                    audioFormat: format,
                    extractAudio: true,
                    restrictFilenames: true,
                    // A link copied while a playlist or a mix plays carries `&list=…`: without this yt-dlp would take
                    // the playlist's first video (into this track's file name) and then walk the whole list.
                    noPlaylist: true,
                    // The user's own yt-dlp.conf (output template, format, post-processors, embedded thumbnails) must not
                    // change what the app gets, nor break the "find the produced file" step.
                    ignoreConfig: true,
                    // A track, not a ten-hour video or a live stream.
                    maxFilesize: MAX_TRACK_FILESIZE,
                    matchFilter: TRACK_MATCH_FILTER,
                };

                // A signed-in browser's cookies, read by yt-dlp itself, when the user chose one; otherwise the imported
                // cookies.txt, if there is one. yt-dlp rewrites the file it is given when it exits, so every run works on
                // its own copy (see `copyCookiesForRun`); the user's file is only read.
                const cookiesBrowser = cookiesBrowserFrom(getDownloadProviderSettings("ytdlp").cookiesBrowser);
                if (cookiesBrowser) {
                    note(`Using the cookies of ${cookiesBrowser}`, "debug");
                    downloadOptions.cookiesFromBrowser = cookiesBrowser;
                } else if (
                    await fs.promises.access(cookiesPath).then(
                        () => true,
                        () => false
                    )
                ) {
                    note(`Using cookies from ${cookiesPath}`, "debug");
                    cookiesCopy = await copyCookiesForRun(cookiesPath);
                    downloadOptions.cookies = cookiesCopy.path;
                } else {
                    // The normal case for most users: not worth a warning on every track.
                    note("No cookies file found, proceeding without cookies", "debug");
                }

                // Use the builder API so we can kill the process on abort
                const client = await this.getClient();
                // Stopped while the set-up ran: the abort listener below would be added too late to ever fire.
                if (rowAbortController.signal.aborted) throw makeAbortError();
                // yt-dlp emits a progress event per stdout line (many per second). The
                // UI only ever shows whole-percent progress, so quantize to integer and
                // ignore ticks that don't change it - that collapses status updates,
                // attribute writes and debug logs from ~10/s to at most one per percent.
                // A slow trickle (percent unchanged) still refreshes the stats twice a second.
                let lastPercent = -1;
                let lastPublish = 0;
                const dl = client.download(trackUrl, downloadOptions).on("progress", (progress) => {
                    percent = Math.floor(progress.percentage ?? 0);
                    const now = Date.now();
                    if (percent === lastPercent && now - lastPublish < 500) return;
                    stats = {
                        downloadedBytes: progress.downloaded,
                        totalBytes: progress.total,
                        speedBytesPerSec: progress.speed,
                        etaSeconds: progress.eta,
                    };
                    lastPublish = now;
                    if (percent !== lastPercent) {
                        lastPercent = percent;
                        this.status.update({ progress: percent });
                        this.logger.debug(
                            `Download progress: ${percent}% ${progress.speed_str} (ETA: ${progress.eta_str})`
                        );
                    }
                    publish();
                });

                // yt-dlp's own messages ("[ExtractAudio] Destination: ..."). Chunks can split lines, and
                // the progress / before-download templates are machine output: a marker line opens a JSON
                // object that yt-dlp may pretty-print over many lines, so skip until its braces balance.
                // One forwarder per stream, since each keeps its own partial line.
                const makeLineForwarder = () => {
                    let pending = "";
                    let skipDepth = 0;
                    const braceDelta = (text: string) => text.split("{").length - text.split("}").length;
                    return (chunk: string) => {
                        const lines = (pending + chunk).split(/\r?\n/);
                        pending = lines.pop() ?? "";
                        for (const raw of lines) {
                            const line = stripAnsi(raw).trim();
                            if (skipDepth > 0) {
                                skipDepth = Math.max(0, skipDepth + braceDelta(line));
                                continue;
                            }
                            if (line.includes("~ytdlp-progress-") || line.startsWith("__YTDLP_BEFORE_DL__:")) {
                                skipDepth = Math.max(0, braceDelta(line));
                                continue;
                            }
                            if (line) note(line, "debug");
                        }
                    };
                };
                dl.on("stdout", makeLineForwarder()).on("stderr", makeLineForwarder());

                // The whole tree: on Windows a plain kill leaves the ffmpeg yt-dlp started running, and the file locked.
                const onAbort = () => killProcessTree(dl);
                rowAbortController.signal.addEventListener("abort", onAbort, { once: true });

                try {
                    await dl.run();
                } catch (error) {
                    // A killed yt-dlp can exit with an error code: that is the stop, not a failed download.
                    if (!rowAbortController.signal.aborted) throw error;
                } finally {
                    rowAbortController.signal.removeEventListener("abort", onAbort);
                }

                // If aborted (task-level or just this row), delete the partial temp file
                // to avoid it being treated as a complete cached download on the next
                // run, then re-raise as AbortError.
                if (rowAbortController.signal.aborted) {
                    // Whatever name yt-dlp had got to: the finished file and any `.part` / intermediate leftovers.
                    await this.removeLeftovers(tempStem);
                    throw makeAbortError();
                }

                if (!nativeFlac) {
                    const produced = (await listTempFilesWithStem(getTempDownloadDir(), tempStem)).find((file) =>
                        isFinishedAudioFile(file, tempStem)
                    );
                    if (produced) fullPath = produced;
                }
                // yt-dlp skips a video that is too long, too big or live and still exits successfully: whatever the
                // output format, no file is the sign.
                if (
                    !(await fs.promises.access(fullPath).then(
                        () => true,
                        () => false
                    ))
                ) {
                    throw new Error(
                        "yt-dlp produced no file (a live stream, or longer than 3 hours, or bigger than 500 MB, is not downloaded as a track)"
                    );
                }

                note(`Successfully downloaded: ${path.basename(fullPath)}`);
                localFile = {
                    state: "found",
                    path: fullPath,
                    name: outputName,
                    extension: extensionOf(fullPath) as LocalFile["extension"],
                    sourceUrl: trackUrl,
                };
            }

            this.status.clear();

            let fileInfo: FileInfo | undefined;
            try {
                // yt-dlp's own FLAC is a lossless wrapper around YouTube's lossy stream; any other file it made
                // is that stream itself (or a cached download of either kind), honestly lossy at its real bitrate.
                const isFlacWrapper = extensionOf(fullPath) === "flac";
                fileInfo = await readFileInfo(
                    fullPath,
                    trackMetadata.duration ?? 0,
                    isFlacWrapper ? "lossy-transcode" : "lossy",
                    // The codec the site always serves, if its service says so (a site with several, like SoundCloud,
                    // declares none, and the badge then says "transcoded" without naming a wrong one).
                    isFlacWrapper ? platformRegistry.upstreamCodec(trackMetadata.apiProvider) : undefined
                );
            } catch (err) {
                this.logger.warn(`Failed to read file info for ${path.basename(fullPath)}`, { error: err });
            }

            const downloadSource: TrackDownloadSource = {
                state: "downloaded",
                provider: "ytdlp",
                track: trackMetadata,
                localFile,
                downloadedAt: new Date(),
                selected: true,
                fileInfo,
                progress: 100,
                query,
            };
            return downloadSource;
        } catch (error) {
            if ((error as Error).name === "AbortError") throw error;
            // The partial files of a run that failed (named after a name no later attempt reuses) go with it.
            if (runStem) await this.removeLeftovers(runStem);
            this.logger.error(`Error downloading track: ${trackMetadata.trackName}`, { error });
            const failure = error instanceof Error ? error.message : String(error);
            // yt-dlp's own words name command-line switches: say what they mean here, and where the fix is.
            const help = explainYtDlpFailure(failure);
            this.status.set({
                type: StatusType.Error,
                message: help
                    ? `${help.short}: ${trackMetadata.trackName}`
                    : `Failed to download ${trackMetadata.trackName}`,
            });
            log.push(`Failed: ${failure}`);
            if (help) log.push(help.advice);
            publish("failed");
            throw error;
        } finally {
            signal?.removeEventListener("abort", onOuterAbort);
            await cookiesCopy?.cleanup().catch(() => {});
        }
    }

    /** Deletes the finished file and any `.part` / intermediate leftovers of a run, saying so when one cannot go. */
    private async removeLeftovers(stem: string): Promise<void> {
        try {
            for (const leftover of await listTempFilesWithStem(getTempDownloadDir(), stem)) {
                await fs.promises.unlink(leftover).catch((error: NodeJS.ErrnoException) => {
                    // Still locked (an antivirus, a process that was not ended): it stays, and the temp clean-up gets it.
                    if (error.code !== "ENOENT")
                        this.logger.warn(`Could not remove ${path.basename(leftover)}`, { error });
                });
            }
        } catch (error) {
            this.logger.warn("Could not list the leftovers of a download", { error });
        }
    }
}
