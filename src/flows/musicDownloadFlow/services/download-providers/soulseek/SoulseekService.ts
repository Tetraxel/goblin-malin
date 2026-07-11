import fs from "fs";
import path from "path";
import slsk from "slsk-client";
import type { SlskFile, SoulseekClient } from "slsk-client";
import { DownloadService } from "../../../downloadService";
import { ProviderDisplay } from "#base/providerDisplay";
import { ProviderSettingsSchema } from "#base/providerSettings";
import { SetupWizardConfig } from "#base/setupWizard";
import { StatusType } from "#base/task/task-status";
import { Logger } from "#base/logger/logger";
import { makeAbortError, throwIfAborted } from "#utils/errors";
import { probeAudio } from "#utils/probeAudio";
import { APIProvider, TrackMetadata, TrackDownloadSource, LocalFile, FileInfo } from "#flows/musicDownloadFlow/types";
import { DownloadTask } from "#flows/musicDownloadFlow/utils/downloadTask";
import { readFileInfo } from "#flows/musicDownloadFlow/utils/readFileInfo";
import { getTempDownloadDir, getDownloadProviderSettings } from "../../../saveSettings";
import { generateTempFilename, deleteExistingTempFiles } from "#flows/musicDownloadFlow/utils/tempFile";
import { cleanSearchTerm, rankResults } from "./ranking";
import { SoulseekCell } from "./SoulseekCell";

// slsk-client's own login handshake timeout (passed as `timeout` to connect())
// defaults to just 2000ms if unset — far too short for a real round-trip to the
// Soulseek server, so it must always be overridden explicitly.
const LOGIN_TIMEOUT_MS = 20_000;
// Outer safety net around the whole connect() call, slightly above LOGIN_TIMEOUT_MS
// so the library's own "timeout login" error (more specific) wins in the normal
// case; this only fires if something hangs before the library's own timer starts.
const CONNECT_TIMEOUT_MS = 25_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const DEFAULT_SEARCH_TIMEOUT_MS = 5000;
// How far a candidate's real (ffprobe-measured) duration may drift from the
// track metadata's duration before it's rejected as a wrong match (e.g. a
// DJ set or album rip that happened to match the filename search).
const DURATION_TOLERANCE_MS = 10_000;

// slsk-client cannot cancel an in-flight peer file transfer (see
// abandonAndReconnect below) — a transfer we've already abandoned can still
// finish afterward, and slsk-client's own bookkeeping for it is gone by then,
// so it falls back to writing `${user}-${token}.mp3` (token = 8 hex chars,
// hardcoded ".mp3" regardless of actual format) relative to process.cwd()
// instead of our chosen destPath. We can't intercept that write, so we sweep
// for and delete it afterward instead.
const ORPHAN_FILE_PATTERN = /^.+-[0-9a-f]{8}\.mp3$/i;
// Grace period after abandoning a download before sweeping for its orphan —
// gives the background transfer a chance to actually land first.
const ORPHAN_SWEEP_DELAY_MS = 30_000;

type Extension = "flac" | "mp3";

export class SoulseekService extends DownloadService {
    static readonly display: ProviderDisplay = {
        label: "Soulseek",
        acronym: "SOULSEEK",
        color: "#2700ff",
        colorSubtle: "#100080",
        colorBright: "#4040ff",
        usesCompiledMetadata: true,
    };
    static readonly cellComponent = SoulseekCell;
    static readonly defaultSettings: ProviderSettingsSchema = {
        enabled: { label: "Enable", defaultValue: false, kind: "checkbox" },
        searchTimeoutMs: {
            label: "Search timeout (ms)",
            defaultValue: String(DEFAULT_SEARCH_TIMEOUT_MS),
            kind: "textInput",
        },
        mp3Fallback: { label: "Fall back to MP3 if no FLAC found", defaultValue: true, kind: "checkbox" },
    };
    static readonly setupWizard: SetupWizardConfig = {
        title: "⚙  Soulseek Setup Wizard",
        providerKey: "soulseek",
        providerType: "download",
        envSection: { name: "Soulseek" },
        description: [
            {
                type: "paragraph",
                text: "Soulseek is a peer-to-peer file-sharing network — the only source here for true lossless audio, since files come directly from other users' libraries instead of being re-encoded from a streaming platform.",
            },
            {
                type: "note",
                text: "Any username/password works — an account is created automatically the first time you connect. Pick credentials you don't use elsewhere.",
            },
            {
                type: "note",
                text: "Only download files you have the right to access under your local laws.",
            },
        ],
        fields: [
            { envVar: "SOULSEEK_USERNAME", label: "USERNAME", required: true },
            { envVar: "SOULSEEK_PASSWORD", label: "PASSWORD", required: true, secret: true },
        ],
    };

    // Soulseek searches by free-text artist/title, so it can serve any metadata
    // source — unlike yt-dlp/etc it isn't tied to a specific platform's URLs.
    public compatibleMetadataProviders: APIProvider[] = [
        "musicBrainz",
        "spotify",
        "itunes",
        "youtube",
        "google",
        "pandora",
        "deezer",
        "tidal",
        "amazon",
        "soundcloud",
        "napster",
        "yandex",
        "spinrilla",
        "audius",
        "audiomack",
        "anghami",
        "boomplay",
        "bandcamp",
        "songlink",
        "spotifyUrlInfo",
    ];

    // The search query is built from free-text artist/title, not tied to whichever
    // metadata group happened to be picked — startDownloads() should hand this
    // service the task's compiled (merged + user-overridden) metadata instead.
    public override readonly usesCompiledMetadataForQuery = true;

    private static client: SoulseekClient | null = null;

    constructor(task: DownloadTask, logger: Logger) {
        super("SoulseekService", task, logger);
    }

    private connectWithTimeout(user: string, pass: string): Promise<SoulseekClient> {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("Soulseek connect timed out")), CONNECT_TIMEOUT_MS);
            slsk.connect({ user, pass, timeout: LOGIN_TIMEOUT_MS }, (err, client) => {
                clearTimeout(timer);
                if (err) {
                    reject(err);
                    return;
                }
                resolve(client);
            });
        });
    }

    private async getClient(): Promise<SoulseekClient> {
        return this.runExclusive("init", async () => {
            if (!SoulseekService.client) {
                const values = await this.env.getVariablesWithWizard(SoulseekService.setupWizard);
                SoulseekService.client = await this.connectWithTimeout(
                    values.SOULSEEK_USERNAME,
                    values.SOULSEEK_PASSWORD
                );
                void this.sweepOrphanedDownloads(); // catch leftovers from a previous run/crash
            }
            return SoulseekService.client;
        });
    }

    /** Drop the cached connection so the next getClient() call reconnects. */
    private reconnect(): void {
        SoulseekService.client?.destroy();
        SoulseekService.client = null;
    }

    /**
     * Delete any `${user}-${token}.mp3` files slsk-client's own fallback wrote to
     * process.cwd() for a transfer we could no longer track (see
     * abandonAndReconnect). Best-effort — errors are logged, never thrown, since
     * this is opportunistic cleanup, not part of the download itself.
     */
    private async sweepOrphanedDownloads(): Promise<void> {
        try {
            const cwd = process.cwd();
            const entries = await fs.promises.readdir(cwd);
            const orphans = entries.filter((f) => ORPHAN_FILE_PATTERN.test(f));
            for (const orphan of orphans) {
                await fs.promises.unlink(path.join(cwd, orphan)).catch(() => {});
            }
            if (orphans.length > 0) {
                this.logger.info(
                    `Cleaned up ${orphans.length} orphaned Soulseek file(s) slsk-client wrote to ${cwd}`
                );
            }
        } catch (error) {
            this.logger.warn("Failed to sweep for orphaned Soulseek downloads", { error });
        }
    }

    /** One automatic reconnect-and-retry if the shared connection looks dead. */
    private async withReconnect<T>(fn: (client: SoulseekClient) => Promise<T>): Promise<T> {
        const client = await this.getClient();
        try {
            return await fn(client);
        } catch (error) {
            this.logger.warn(`Soulseek operation failed, reconnecting once`, { error });
            this.reconnect();
            const retriedClient = await this.getClient();
            return fn(retriedClient);
        }
    }

    private searchOnce(query: string, timeoutMs: number): Promise<SlskFile[]> {
        return this.withReconnect(
            (client) =>
                new Promise<SlskFile[]>((resolve, reject) => {
                    client.search({ req: query, timeout: timeoutMs }, (err, res) => {
                        if (err) {
                            reject(err);
                            return;
                        }
                        resolve(res ?? []);
                    });
                })
        );
    }

    // slsk-client has no way to cancel one in-flight peer transfer, so simply
    // giving up *waiting* on it (the old approach here) let it keep running in the
    // background. The peer file-transfer socket is opened by slsk-client's internal
    // download-peer-file module as a raw, untracked connection (never registered in
    // its `peers` map), so — unlike a stalled search/chat connection — even
    // destroying the whole client via reconnect() does NOT close it. It genuinely
    // cannot be cancelled through any public API. When it eventually finishes,
    // slsk-client's own bookkeeping for that transfer is already gone, so it falls
    // through to *its* internal fallback: writing straight to `${user}-${token}.mp3`
    // relative to process.cwd() (see
    // node_modules/slsk-client/lib/peer/download-peer-file.js) instead of our
    // chosen destPath. Since we can't prevent that write, sweepOrphanedDownloads()
    // is scheduled to delete it once it's had time to land. reconnect() still runs
    // here too — separately useful in case the *connection* itself (not just this
    // one transfer) is actually the thing that's stuck.
    private abandonAndReconnect(reject: (error: Error) => void, error: Error): void {
        this.logger.warn(`Abandoning Soulseek download (${error.message}); reconnecting the client`);
        this.reconnect();
        setTimeout(() => void this.sweepOrphanedDownloads(), ORPHAN_SWEEP_DELAY_MS).unref();
        reject(error);
    }

    private downloadCandidate(file: SlskFile, destPath: string, signal?: AbortSignal): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const cleanup = () => {
                clearTimeout(timer);
                signal?.removeEventListener("abort", onAbort);
            };
            const onAbort = () => {
                cleanup();
                this.abandonAndReconnect(reject, makeAbortError());
            };
            signal?.addEventListener("abort", onAbort, { once: true });
            const timer = setTimeout(() => {
                cleanup();
                this.abandonAndReconnect(reject, new Error("Soulseek download timed out"));
            }, DOWNLOAD_TIMEOUT_MS);

            this.getClient()
                .then((client) => {
                    client.download({ file, path: destPath }, (err) => {
                        cleanup();
                        if (err) {
                            reject(err);
                            return;
                        }
                        resolve();
                    });
                })
                .catch((error) => {
                    cleanup();
                    reject(error);
                });
        });
    }

    async downloadTrack(
        trackMetadata: TrackMetadata,
        onUpdate?: (source: TrackDownloadSource, options?: { attemptId?: string }) => void,
        signal?: AbortSignal
    ): Promise<TrackDownloadSource> {
        const pendingSource: TrackDownloadSource = {
            state: "searching",
            provider: "soulseek",
            track: trackMetadata,
            downloadedAt: new Date(),
            selected: false,
            progress: 0,
        };
        onUpdate?.(pendingSource);

        // Stable per-candidate row identity, assigned once results are ranked so every
        // candidate can be shown immediately as "pending" and later updated in place as
        // it's actually attempted. The very first candidate overall reuses the default
        // (undefined) key — the same row the initial "searching" state above opened —
        // so that row seamlessly becomes "candidate 1" instead of leaving a stale
        // leftover "searching" row once real candidates are known.
        let attemptCount = 0;
        const nextAttemptId = (): string | undefined =>
            attemptCount++ === 0 ? undefined : `candidate-${attemptCount - 1}`;
        let lastCandidate: SlskFile | undefined;

        const artistName = trackMetadata.artists?.[0]?.name ?? "";
        const trackTitle = trackMetadata.trackName;
        const albumName = trackMetadata.album?.albumName;

        const settings = getDownloadProviderSettings("soulseek");
        const searchTimeoutMs = Number(settings.searchTimeoutMs) || DEFAULT_SEARCH_TIMEOUT_MS;
        const mp3FallbackEnabled = settings.mp3Fallback !== false;
        const extensionsToTry: Extension[] = mp3FallbackEnabled ? ["flac", "mp3"] : ["flac"];

        try {
            this.logger.info(`Searching Soulseek for: ${artistName} - ${trackTitle}`);
            this.status.set({
                type: StatusType.Processing,
                message: `Searching Soulseek for ${trackTitle}`,
                timeTracking: true,
                progress: 0,
            });

            const tempDir = getTempDownloadDir();
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }

            for (const extension of extensionsToTry) {
                throwIfAborted(signal);

                // Unlike yt-dlp (same URL → the same bytes, every time), Soulseek's
                // available peers/files genuinely change over time — reusing an old
                // temp file here would silently skip the search and collapse the
                // multi-candidate view down to whatever was cached before. Always
                // search fresh, clearing out any leftover file from a previous attempt
                // first so retries don't just pile up unused files in the temp dir.
                deleteExistingTempFiles(SoulseekService.display.label, trackMetadata, extension, tempDir);

                const query = cleanSearchTerm(`${artistName} ${trackTitle} .${extension}`);
                this.status.update({ progress: 10 });
                const results = await this.searchOnce(query, searchTimeoutMs);
                this.status.update({ progress: 30 });

                const candidates = rankResults(results, { artistName, trackTitle, albumName, extension });
                if (candidates.length === 0) {
                    this.logger.info(`No ranked Soulseek candidates for "${extension}"`);
                    continue;
                }

                this.logger.info(`Found ${candidates.length} ranked Soulseek candidates for "${extension}"`);

                // Assign every candidate its row identity up front and show them all
                // immediately as "pending" — the user sees the full ranked field for
                // this format right away, instead of one row revealed at a time.
                const attempts = candidates.map((candidate) => ({ candidate, attemptId: nextAttemptId() }));
                for (const { candidate, attemptId } of attempts) {
                    onUpdate?.(
                        {
                            state: "pending",
                            provider: "soulseek",
                            track: trackMetadata,
                            downloadedAt: new Date(),
                            selected: false,
                            providerDetail: candidate.user,
                            retryPayload: candidate,
                        },
                        { attemptId }
                    );
                }

                // Still only ever one candidate downloading at a time, sequentially,
                // stopping at the first success — no extra files are fetched. Each
                // candidate's own row (opened above) is updated in place as it's
                // attempted; any candidates never reached are marked "skipped" once a
                // winner is found (see markRemainingSkipped below), rather than being
                // left in a "pending" state that would misleadingly imply they're still
                // queued to run. Skipped (and failed) rows keep their `retryPayload` so
                // the user can still manually download that exact candidate later.
                const markRemainingSkipped = (fromIndex: number) => {
                    for (const { candidate: skippedCandidate, attemptId: skippedId } of attempts.slice(fromIndex)) {
                        onUpdate?.(
                            {
                                state: "skipped",
                                provider: "soulseek",
                                track: trackMetadata,
                                downloadedAt: new Date(),
                                selected: false,
                                providerDetail: skippedCandidate.user,
                                retryPayload: skippedCandidate,
                            },
                            { attemptId: skippedId }
                        );
                    }
                };

                for (const [attemptIndex, { candidate, attemptId }] of attempts.entries()) {
                    throwIfAborted(signal);
                    lastCandidate = candidate;
                    const result = await this.attemptSingleCandidate(
                        trackMetadata,
                        candidate,
                        extension,
                        tempDir,
                        onUpdate,
                        attemptId,
                        signal
                    );
                    if (result) {
                        markRemainingSkipped(attemptIndex + 1);
                        return result;
                    }
                }
            }

            // Exhausting every candidate across every extension is a normal
            // terminal outcome, not an exceptional one — surface it as a
            // failed source so the user sees "no results", not a silently
            // missing row. If candidates were actually tried, this return value lands
            // on the last one's own row (via its attemptId) — keep its providerDetail/
            // retryPayload rather than the generic pendingSource, so that row doesn't
            // lose which peer it was or the ability to retry it.
            this.logger.info(`No usable Soulseek results for: ${trackTitle}`);
            this.status.set({ type: StatusType.Error, message: "No results" });
            return {
                ...pendingSource,
                state: "failed",
                progress: 0,
                providerDetail: lastCandidate?.user,
                retryPayload: lastCandidate,
            };
        } catch (error) {
            if ((error as Error).name === "AbortError") throw error;
            this.logger.error(`Error downloading track from Soulseek: ${trackTitle}`, { error });
            this.status.set({
                type: StatusType.Error,
                message: `Failed to download ${trackTitle}`,
            });
            onUpdate?.({ ...pendingSource, state: "failed" });
            throw error;
        }
    }

    /**
     * Attempt exactly one candidate: download it, reject on duration mismatch, and
     * finalize on success. Returns null (having already emitted a "failed" onUpdate)
     * on any non-abort failure, so callers can decide what to do next — the main
     * sequential loop moves on to the next candidate; `retryCandidate` (one-off,
     * user-triggered) just reports the failure back as its return value.
     */
    private async attemptSingleCandidate(
        trackMetadata: TrackMetadata,
        candidate: SlskFile,
        extension: Extension,
        tempDir: string,
        onUpdate: ((source: TrackDownloadSource, options?: { attemptId?: string }) => void) | undefined,
        attemptId: string | undefined,
        signal: AbortSignal | undefined
    ): Promise<TrackDownloadSource | null> {
        onUpdate?.(
            {
                state: "downloading",
                provider: "soulseek",
                track: trackMetadata,
                downloadedAt: new Date(),
                selected: false,
                progress: 50,
                providerDetail: candidate.user,
                retryPayload: candidate,
            },
            { attemptId }
        );

        const destPath = path.join(
            tempDir,
            generateTempFilename(SoulseekService.display.label, trackMetadata, extension)
        );

        try {
            await this.downloadCandidate(candidate, destPath, signal);

            if (trackMetadata.duration != null) {
                const probed = await probeAudio(destPath);
                if (probed?.durationMs && Math.abs(probed.durationMs - trackMetadata.duration) > DURATION_TOLERANCE_MS) {
                    this.logger.warn(
                        `Rejecting candidate from ${candidate.user}: duration mismatch (got ${probed.durationMs}ms, expected ~${trackMetadata.duration}ms)`
                    );
                    await fs.promises.unlink(destPath).catch(() => {});
                    onUpdate?.(
                        {
                            state: "failed",
                            provider: "soulseek",
                            track: trackMetadata,
                            downloadedAt: new Date(),
                            selected: false,
                            providerDetail: candidate.user,
                            retryPayload: candidate,
                        },
                        { attemptId }
                    );
                    return null;
                }
            }

            return await this.finalizeDownload(trackMetadata, destPath, extension, candidate);
        } catch (error) {
            await fs.promises.unlink(destPath).catch(() => {});
            if ((error as Error).name === "AbortError") throw error;
            this.logger.warn(`Candidate download failed from ${candidate.user}`, { error });
            onUpdate?.(
                {
                    state: "failed",
                    provider: "soulseek",
                    track: trackMetadata,
                    downloadedAt: new Date(),
                    selected: false,
                    providerDetail: candidate.user,
                    retryPayload: candidate,
                },
                { attemptId }
            );
            return null;
        }
    }

    /**
     * Manually retry one specific previously-found candidate — e.g. a "skipped" or
     * "failed" row the user wants downloaded anyway. `retryPayload` is the exact
     * `SlskFile` this service attached to that row earlier.
     */
    async retryCandidate(
        trackMetadata: TrackMetadata,
        retryPayload: unknown,
        onUpdate?: (source: TrackDownloadSource, options?: { attemptId?: string }) => void,
        signal?: AbortSignal
    ): Promise<TrackDownloadSource> {
        const candidate = retryPayload as SlskFile;
        const extension = path.win32.extname(candidate.file).slice(1).toLowerCase() as Extension;

        const tempDir = getTempDownloadDir();
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        const result = await this.attemptSingleCandidate(
            trackMetadata,
            candidate,
            extension,
            tempDir,
            onUpdate,
            undefined,
            signal
        );
        if (result) return result;

        return {
            state: "failed",
            provider: "soulseek",
            track: trackMetadata,
            downloadedAt: new Date(),
            selected: false,
            providerDetail: candidate.user,
            retryPayload: candidate,
        };
    }

    private async finalizeDownload(
        trackMetadata: TrackMetadata,
        filePath: string,
        extension: Extension,
        candidate?: SlskFile
    ): Promise<TrackDownloadSource> {
        const artistName = trackMetadata.artists?.[0]?.name ?? "Unknown Artist";
        const localFile: LocalFile = {
            state: "found",
            path: filePath,
            name: `${artistName} - ${trackMetadata.trackName}`,
            extension,
        };

        this.status.clear();

        let fileInfo: FileInfo | undefined;
        try {
            // Soulseek FLACs are the genuine lossless source this provider exists for;
            // MP3 fallbacks are honestly lossy at their real (probed) bitrate.
            fileInfo = await readFileInfo(filePath, trackMetadata.duration ?? 0, extension === "flac" ? "lossless" : "lossy");
        } catch (err) {
            this.logger.warn(`Failed to read file info for ${path.basename(filePath)}`, { error: err });
        }

        this.logger.info(`Successfully downloaded from Soulseek: ${path.basename(filePath)}`);

        return {
            state: "downloaded",
            provider: "soulseek",
            track: trackMetadata,
            localFile,
            downloadedAt: new Date(),
            selected: true,
            fileInfo,
            progress: 100,
            providerDetail: candidate?.user,
            retryPayload: candidate,
        };
    }
}
