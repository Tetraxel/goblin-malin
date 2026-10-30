import fs from "fs";
import path from "path";
import { FormatOptions, QualityOptions, YtDlp } from "ytdlp-nodejs";
import stripAnsi from "strip-ansi";
import { DownloadService, DownloadUpdateCallback } from "../../../downloadService";
import { ProviderDisplay } from "#base/providerDisplay";
import { ProviderSettingsSchema } from "#base/providerSettings";
import { StatusType } from "#base/task/task-status";
import { Logger } from "#base/logger/logger";
import { getBinDir } from "#utils/appPaths";
import { makeAbortError } from "#utils/errors";
import { ensureFfmpeg } from "#utils/ffmpeg-setup";
import {
    APIProvider,
    TrackMetadata,
    TrackDownloadSource,
    DownloadProgressInfo,
    LocalFile,
    FileInfo,
} from "#flows/musicDownloadFlow/types";
import { DownloadTask } from "#flows/musicDownloadFlow/utils/downloadTask";
import { readFileInfo } from "#flows/musicDownloadFlow/utils/readFileInfo";
import { ensureYtDlpSetup } from "./ytdlp-setup";
import { YtDlpCell } from "./YtDlpCell";
import { getTempDownloadDir, getDownloadProviderSettings } from "../../../saveSettings";
import { generateTempFilename, findExistingTempFile } from "#flows/musicDownloadFlow/utils/tempFile";

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
    };
    static readonly cellComponent = YtDlpCell;

    public compatibleMetadataProviders: APIProvider[] = ["youtube", "soundcloud"];
    private static client: YtDlp;

    constructor(task: DownloadTask, logger: Logger) {
        super("YtDlpService", task, logger);
    }

    private async getClient(): Promise<YtDlp> {
        return this.runExclusive("init", async () => {
            if (!YtDlpService.client) {
                // Only update the binaries to the latest release when the user
                // opted in; an absent binary is always downloaded regardless.
                const autoDownloadBinary = getDownloadProviderSettings("ytdlp").autoDownloadBinary !== false;
                const ytDlpBinaryPath = await ensureYtDlpSetup(autoDownloadBinary);
                const ffmpefBinaryPath = await ensureFfmpeg(autoDownloadBinary);
                const ytDlpClient = new YtDlp({
                    binaryPath: ytDlpBinaryPath,
                    ffmpegPath: ffmpefBinaryPath,
                });
                YtDlpService.client = ytDlpClient;
            }
            return YtDlpService.client;
        });
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
        const rowAbortController = new AbortController();
        const onOuterAbort = () => rowAbortController.abort();
        signal?.addEventListener("abort", onOuterAbort, { once: true });
        const reportAbort = () => rowAbortController.abort();

        // In-progress source emitted right away so the UI shows the download before it completes.
        const startedAt = Date.now();
        const pendingSource: TrackDownloadSource = {
            state: "downloading",
            provider: "ytdlp",
            track: trackMetadata,
            downloadedAt: new Date(),
            selected: false,
            progress: 0,
            progressInfo: { startedAt },
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

        try {
            note(`Downloading track from ${trackMetadata.apiProvider}: ${trackMetadata.trackName}`);
            this.status.set({
                type: StatusType.Processing,
                message: `Downloading ${trackMetadata.trackName}`,
                timeTracking: true,
                progress: 0,
            });

            const format = "flac";
            const artistName = trackMetadata.artists?.[0]?.name ?? "Unknown Artist";
            const outputName = `${artistName} - ${trackMetadata.trackName}`;

            const existingPath = findExistingTempFile(
                YtDlpService.display.label,
                trackMetadata,
                format,
                getTempDownloadDir()
            );
            const fullPath =
                existingPath ??
                path.join(
                    getTempDownloadDir(),
                    generateTempFilename(YtDlpService.display.label, trackMetadata, format)
                );

            // Check if file already exists
            let localFile: LocalFile;
            if (existingPath) {
                note(`File already exists, skipping download: ${path.basename(fullPath)}`);
                localFile = {
                    state: "found",
                    path: fullPath,
                    name: outputName,
                    extension: "flac",
                    sourceUrl: trackUrl,
                };
            } else {
                // Ensure download directory exists
                if (!fs.existsSync(getTempDownloadDir())) {
                    fs.mkdirSync(getTempDownloadDir(), { recursive: true });
                }

                // Load cookies if available
                const cookiesPath = path.join(getBinDir(), "cookies.txt");
                const downloadOptions: FormatOptions<keyof QualityOptions> = {
                    paths: getTempDownloadDir(),
                    output: path.basename(fullPath),
                    audioFormat: format,
                    extractAudio: true,
                    restrictFilenames: true,
                };

                // Add cookies if the file exists
                if (fs.existsSync(cookiesPath)) {
                    note(`Using cookies from ${cookiesPath}`, "debug");
                    downloadOptions.cookies = cookiesPath;
                } else {
                    note("No cookies file found, proceeding without cookies", "warn");
                }

                // Use the builder API so we can kill the process on abort
                const client = await this.getClient();
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

                const onAbort = () => dl.kill();
                rowAbortController.signal.addEventListener("abort", onAbort, { once: true });

                try {
                    await dl.run();
                } finally {
                    rowAbortController.signal.removeEventListener("abort", onAbort);
                    signal?.removeEventListener("abort", onOuterAbort);
                }

                // If aborted (task-level or just this row), delete the partial temp file
                // to avoid it being treated as a complete cached download on the next
                // run, then re-raise as AbortError.
                if (rowAbortController.signal.aborted) {
                    await fs.promises.unlink(fullPath).catch(() => {});
                    throw makeAbortError();
                }

                note(`Successfully downloaded: ${path.basename(fullPath)}`);
                localFile = {
                    state: "found",
                    path: fullPath,
                    name: outputName,
                    extension: "flac",
                    sourceUrl: trackUrl,
                };
            }

            this.status.clear();

            let fileInfo: FileInfo | undefined;
            try {
                fileInfo = await readFileInfo(fullPath, trackMetadata.duration ?? 0, "lossy-transcode", "Opus");
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
            };
            return downloadSource;
        } catch (error) {
            if ((error as Error).name === "AbortError") throw error;
            this.logger.error(`Error downloading track: ${trackMetadata.trackName}`, { error });
            this.status.set({
                type: StatusType.Error,
                message: `Failed to download ${trackMetadata.trackName}`,
            });
            log.push(`Failed: ${error instanceof Error ? error.message : String(error)}`);
            publish("failed");
            throw error;
        }
    }
}
