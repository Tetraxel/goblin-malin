import fs from "fs";
import path from "path";
import { DownloadCancelledError, SlskClient, type SearchResult } from "slsk-client";
import { DownloadService, type DownloadUpdateCallback } from "../../../downloadService";
import { type ProviderDisplay } from "#base/providerDisplay";
import { type ProviderSettingsSchema } from "#base/providerSettings";
import { type SetupWizardConfig } from "#base/setupWizard";
import { StatusType } from "#base/task/task-status";
import { type Logger } from "#base/logger/logger";
import { makeAbortError, throwIfAborted } from "#utils/errors";
import { probeAudio } from "#utils/probeAudio";
import {
    type APIProvider,
    type TrackMetadata,
    type TrackDownloadSource,
    type DownloadQueryField,
    type LocalFile,
    type FileInfo,
    type HiddenCandidate,
} from "#flows/musicDownloadFlow/types";
import { type DownloadTask } from "#flows/musicDownloadFlow/utils/downloadTask";
import { readFileInfo } from "#flows/musicDownloadFlow/utils/readFileInfo";
import { getTempDownloadDir, getDownloadProviderSettings } from "../../../saveSettings";
import { generateTempFilename, deleteExistingTempFiles } from "#flows/musicDownloadFlow/utils/tempFile";
import {
    cleanSearchTerm,
    rankResults,
    parseResultsLimit,
    remoteFileName,
    DEFAULT_RESULTS_LIMIT,
    MAX_DOWNLOAD_ATTEMPTS,
    MAX_HIDDEN_RESULTS,
    DURATION_TOLERANCE_MS,
    announcedAudio,
} from "./ranking";
import { SoulseekCell } from "./SoulseekCell";

// slsk-client's login timeout defaults to 2000ms, far too short for a real round-trip to the Soulseek
// server, so it is always set explicitly.
const LOGIN_TIMEOUT_MS = 20_000;
// A download fails after this long without any progress (queue updates count as progress). Downloads are
// cancellable, so the transfer really stops: nothing is left running or written behind our back.
const DOWNLOAD_TIMEOUT_MS = 60_000;
// How often a download waiting in a peer's queue asks for its place. Each answer counts as progress for
// DOWNLOAD_TIMEOUT_MS, so it must come well within it (slsk-client's default, 60 s, would race it).
const QUEUE_POLL_INTERVAL_MS = 20_000;
const DEFAULT_SEARCH_TIMEOUT_MS = 5000;

/**
 * What a row keeps to download its file again later. Rows saved by older versions hold a slsk-client 1.x
 * result (`bitrate` instead of `attribs`), so only the fields both versions share are relied on.
 */
type Candidate = Pick<SearchResult, "user" | "file" | "size" | "slots"> & Partial<Pick<SearchResult, "attribs">>;

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
        mp3Fallback: { label: "Fall back to MP3 if no FLAC found", defaultValue: true, kind: "checkbox" },
        searchTimeoutMs: {
            label: "Search timeout (ms)",
            defaultValue: String(DEFAULT_SEARCH_TIMEOUT_MS),
            kind: "textInput",
        },
        resultsLimit: {
            label: `Results shown per search (more on demand, max ${MAX_HIDDEN_RESULTS})`,
            defaultValue: String(DEFAULT_RESULTS_LIMIT),
            kind: "textInput",
        },
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

    private static client: SlskClient | null = null;

    constructor(task: DownloadTask, logger: Logger) {
        super("SoulseekService", task, logger);
    }

    /**
     * Logs in with a new client. It shares nothing and uploads nothing (slsk-client's defaults, spelled out),
     * picks a dropped server connection up again by itself, and listens for incoming peer connections, which
     * lets peers behind a firewall reach us. A busy listening port only costs those peers, so it is a warning.
     */
    private async login(user: string, pass: string): Promise<SlskClient> {
        const client = new SlskClient({
            timeout: LOGIN_TIMEOUT_MS,
            uploads: false,
            queuePollInterval: QUEUE_POLL_INTERVAL_MS,
        });
        client.on("listen-error", (error) =>
            this.logger.warn(`Soulseek can't accept incoming peer connections (port ${client.incomingPort})`, { error })
        );
        client.on("server-error", (error) => this.logger.warn("Soulseek server connection error", { error }));
        try {
            await client.login(user, pass);
            return client;
        } catch (error) {
            client.destroy();
            throw error;
        }
    }

    private async getClient(): Promise<SlskClient> {
        return this.runExclusive("init", async () => {
            if (!SoulseekService.client) {
                const values = await this.env.getVariablesWithWizard(SoulseekService.setupWizard);
                SoulseekService.client = await this.login(values.SOULSEEK_USERNAME, values.SOULSEEK_PASSWORD);
            }
            return SoulseekService.client;
        });
    }

    /** Drop the cached connection so the next getClient() call logs in again. */
    private reconnect(): void {
        SoulseekService.client?.destroy();
        SoulseekService.client = null;
    }

    /** One automatic reconnect-and-retry if the shared connection looks dead. */
    private async withReconnect<T>(fn: (client: SlskClient) => Promise<T>): Promise<T> {
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

    /** The exact text sent to Soulseek's search for one format: artist, title, then the `.ext` filter. */
    private searchQuery(trackMetadata: TrackMetadata, extension: Extension): string {
        const artistName = trackMetadata.artists?.[0]?.name ?? "";
        return cleanSearchTerm(`${artistName} ${trackMetadata.trackName} .${extension}`);
    }

    /** What every row found by that search records as its query: the one search box, as sent. */
    private queryFields(trackMetadata: TrackMetadata, extension: Extension): DownloadQueryField[] {
        return [{ label: "Search", value: this.searchQuery(trackMetadata, extension) }];
    }

    /** What a row (or a not-yet-listed result) records about the remote file and its peer. */
    private candidateStub(
        file: Candidate,
        note: string | undefined = file.slots ? undefined : "queued"
    ): HiddenCandidate {
        const audio = announcedAudio(file);
        return {
            providerDetail: file.user,
            candidate: {
                name: remoteFileName(file.file),
                sizeBytes: file.size,
                note,
                ...(Object.values(audio).some((v) => v != null) ? { audio } : {}),
            },
            retryPayload: file,
        };
    }

    private searchOnce(query: string, timeoutMs: number): Promise<SearchResult[]> {
        return this.withReconnect((client) => client.search({ req: query, timeout: timeoutMs }));
    }

    /**
     * Downloads one file to `destPath`, reporting progress as a 0–1 ratio. Aborting `signal` cancels the
     * transfer itself (it rejects with an AbortError); a peer silent for DOWNLOAD_TIMEOUT_MS fails it.
     */
    private async downloadCandidate(
        file: Candidate,
        destPath: string,
        signal: AbortSignal,
        onProgress: (ratio: number) => void,
        onQueued: (place: number | undefined) => void
    ): Promise<void> {
        const client = await this.getClient();
        throwIfAborted(signal);
        const download = client.download({
            user: file.user,
            file: file.file,
            size: file.size,
            path: destPath,
            timeout: DOWNLOAD_TIMEOUT_MS,
            signal,
        });
        download.on("progress", ({ progress }) => {
            if (progress !== undefined) onProgress(progress);
        });
        // Place 0 means the transfer is starting: progress takes over from there.
        download.on("status", (status) => {
            if (status === "queued") onQueued(undefined);
        });
        download.on("queue", (place) => {
            if (place > 0) onQueued(place);
        });
        try {
            await download;
        } catch (error) {
            if (error instanceof DownloadCancelledError || signal.aborted) throw makeAbortError();
            throw error;
        }
    }

    async downloadTrack(
        trackMetadata: TrackMetadata,
        reportUpdate?: DownloadUpdateCallback,
        signal?: AbortSignal
    ): Promise<TrackDownloadSource> {
        // The row last reported: a final "failed" result is applied to it (see the end of this method).
        let lastEmitted: TrackDownloadSource | undefined;
        const onUpdate: DownloadUpdateCallback = (source, options) => {
            lastEmitted = source;
            reportUpdate?.(source, options);
        };
        const pendingSource: TrackDownloadSource = {
            state: "searching",
            provider: "soulseek",
            track: trackMetadata,
            downloadedAt: new Date(),
            selected: false,
            progress: 0,
            // The first search is for FLAC; rows found later carry the query that actually found them.
            query: this.queryFields(trackMetadata, "flac"),
        };
        onUpdate(pendingSource);
        let lastQuery = pendingSource.query;

        // Stable per-candidate row identity, assigned once results are ranked so every
        // candidate can be shown immediately as "pending" and later updated in place as
        // it's actually attempted. The very first candidate overall reuses the default
        // (undefined) key — the same row the initial "searching" state above opened —
        // so that row seamlessly becomes "candidate 1" instead of leaving a stale
        // leftover "searching" row once real candidates are known.
        let rowCount = 0;
        const nextAttemptId = (): string | undefined => (rowCount++ === 0 ? undefined : `candidate-${rowCount - 1}`);

        const artistName = trackMetadata.artists?.[0]?.name ?? "";
        const trackTitle = trackMetadata.trackName;
        const albumName = trackMetadata.album?.albumName;

        const settings = getDownloadProviderSettings("soulseek");
        const searchTimeoutMs = Number(settings.searchTimeoutMs) || DEFAULT_SEARCH_TIMEOUT_MS;
        const resultsLimit = parseResultsLimit(settings.resultsLimit);
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
                await deleteExistingTempFiles(SoulseekService.display.label, trackMetadata, extension, tempDir);

                const query = this.searchQuery(trackMetadata, extension);
                const queryFields = this.queryFields(trackMetadata, extension);
                lastQuery = queryFields;
                this.status.update({ progress: 10 });
                const results = await this.searchOnce(query, searchTimeoutMs);
                this.status.update({ progress: 30 });

                // Every usable result, best first (free-slot peers before queued ones). Only the
                // top `resultsLimit` become rows; a bounded remainder is kept behind a "show more" row.
                const ranked = rankResults(
                    results,
                    { artistName, trackTitle, albumName, extension, durationMs: trackMetadata.duration ?? undefined },
                    resultsLimit + MAX_HIDDEN_RESULTS
                );
                if (ranked.length === 0) {
                    this.logger.info(`No ranked Soulseek candidates for "${extension}"`);
                    continue;
                }

                const listed = ranked.slice(0, resultsLimit);
                const unlisted = ranked.slice(resultsLimit);
                this.logger.info(
                    `Found ${ranked.length} ranked Soulseek candidates for "${extension}" (listing ${listed.length})`
                );

                // Only peers with a free slot are downloaded from automatically (sorted first, so
                // they are the head of `listed`); the rest of the list is there to be picked by hand.
                const autoAttemptCount = Math.min(
                    MAX_DOWNLOAD_ATTEMPTS,
                    resultsLimit,
                    listed.filter((candidate) => candidate.slots).length
                );

                // Assign every listed result its row identity up front and show them all
                // immediately — the user sees the full ranked field for this format right
                // away, instead of one row revealed at a time. Those that will be tried are
                // "pending"; the others are "skipped" from the start (still downloadable by hand).
                // The last row carries the stubs of everything not listed.
                const listedRow = (
                    candidate: SearchResult,
                    state: "pending" | "skipped",
                    isLastListed: boolean
                ): TrackDownloadSource => ({
                    state,
                    provider: "soulseek",
                    track: trackMetadata,
                    downloadedAt: new Date(),
                    selected: false,
                    ...this.candidateStub(candidate),
                    query: queryFields,
                    ...(isLastListed && unlisted.length > 0
                        ? { moreCandidates: unlisted.map((file) => this.candidateStub(file)) }
                        : {}),
                });
                const attempts = listed.map((candidate, index) => ({
                    candidate,
                    attemptId: nextAttemptId(),
                    row: listedRow(
                        candidate,
                        index < autoAttemptCount ? "pending" : "skipped",
                        index === listed.length - 1
                    ),
                }));
                for (const { attemptId, row } of attempts) {
                    onUpdate(row, { attemptId });
                }
                const attemptedRows = attempts.slice(0, autoAttemptCount);

                // Still only ever one candidate downloading at a time, sequentially,
                // stopping at the first success — no extra files are fetched. Each
                // candidate's own row (opened above) is updated in place as it's
                // attempted; any candidates never reached are marked "skipped" once a
                // winner is found (see markRemainingSkipped below), rather than being
                // left in a "pending" state that would misleadingly imply they're still
                // queued to run. Skipped (and failed) rows keep their `retryPayload` so
                // the user can still manually download that exact candidate later.
                const markRemainingSkipped = (fromIndex: number) => {
                    for (const { row, attemptId: skippedId } of attemptedRows.slice(fromIndex)) {
                        onUpdate({ ...row, state: "skipped" }, { attemptId: skippedId });
                    }
                };

                for (const [attemptIndex, { candidate, attemptId }] of attemptedRows.entries()) {
                    throwIfAborted(signal);
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
                        // The task applies the returned source to the row of the *last*
                        // onUpdate call — which is now the last skipped candidate's. Re-address
                        // the winner's own row last so its result doesn't land on that one.
                        onUpdate(result, { attemptId });
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
            // This return value lands on the row last reported. If that is a listed result (attempted and
            // failed, or never attempted because every peer was queued), keep its file and peer rather
            // than overwriting it with a generic "failed" that forgets which file it was.
            const lastRow: TrackDownloadSource | undefined = lastEmitted;
            if (lastRow?.retryPayload != null) {
                return { ...lastRow, state: lastRow.state === "skipped" ? "skipped" : "failed", progress: 0 };
            }
            return { ...pendingSource, state: "failed", progress: 0, query: lastQuery };
        } catch (error) {
            if ((error as Error).name === "AbortError") throw error;
            this.logger.error(`Error downloading track from Soulseek: ${trackTitle}`, { error });
            this.status.set({
                type: StatusType.Error,
                message: `Failed to download ${trackTitle}`,
            });
            onUpdate({ ...pendingSource, state: "failed" });
            throw error;
        }
    }

    /**
     * Attempt exactly one candidate: download it, reject on duration mismatch, and
     * finalize on success. Returns null (having already emitted a "failed" onUpdate)
     * on any non-abort failure — including this *one* candidate being cancelled via
     * its row's `abort` handle (e.g. the user rejected it) — so callers can decide
     * what to do next: the main sequential loop moves on to the next candidate;
     * `retryCandidate` (one-off, user-triggered) just reports the failure back as
     * its return value. Only a genuine task-level abort (the outer `signal`) is
     * re-thrown, since that should stop the whole search, not just this candidate.
     */
    private async attemptSingleCandidate(
        trackMetadata: TrackMetadata,
        candidate: Candidate,
        extension: Extension,
        tempDir: string,
        onUpdate: DownloadUpdateCallback | undefined,
        attemptId: string | undefined,
        signal: AbortSignal | undefined
    ): Promise<TrackDownloadSource | null> {
        // This candidate's own cancel handle, linked to the outer/task-level signal
        // so a real task abort still cancels it too, but independently abortable via
        // the row's `abort` option (e.g. rejectDownloadSource) without touching any
        // other candidate or the search loop itself.
        const query = this.queryFields(trackMetadata, extension);
        const candidateController = new AbortController();
        const onOuterAbort = () => candidateController.abort();
        signal?.addEventListener("abort", onOuterAbort, { once: true });

        // No `progress` until the peer starts sending: StateBadge then shows a plain "DOWNLOADING", and the
        // note says where the file stands in the peer's queue while it waits there.
        const downloadingRow = (progress?: number, note?: string): TrackDownloadSource => ({
            state: "downloading",
            provider: "soulseek",
            track: trackMetadata,
            downloadedAt: new Date(),
            selected: false,
            ...this.candidateStub(candidate, note),
            query,
            ...(progress !== undefined ? { progress } : {}),
        });
        const abort = () => candidateController.abort();
        onUpdate?.(downloadingRow(), { attemptId, abort });
        // Progress arrives with every chunk: the row is only updated when the whole percentage changes.
        let shownPercent = -1;
        const onProgress = (ratio: number) => {
            const percent = Math.floor(ratio * 100);
            if (percent === shownPercent) return;
            shownPercent = percent;
            onUpdate?.(downloadingRow(percent), { attemptId, abort });
        };
        const onQueued = (place: number | undefined) => {
            if (shownPercent >= 0) return; // already transferring
            onUpdate?.(downloadingRow(undefined, place ? `queued #${place}` : "queued"), { attemptId, abort });
        };

        const destPath = path.join(
            tempDir,
            generateTempFilename(SoulseekService.display.label, trackMetadata, extension)
        );

        try {
            await this.downloadCandidate(candidate, destPath, candidateController.signal, onProgress, onQueued);

            if (trackMetadata.duration != null) {
                const probed = await probeAudio(destPath);
                if (
                    probed?.durationMs &&
                    Math.abs(probed.durationMs - trackMetadata.duration) > DURATION_TOLERANCE_MS
                ) {
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
                            ...this.candidateStub(candidate),
                            query,
                        },
                        { attemptId }
                    );
                    return null;
                }
            }

            return await this.finalizeDownload(trackMetadata, destPath, extension, candidate);
        } catch (error) {
            await fs.promises.unlink(destPath).catch(() => {});
            if ((error as Error).name === "AbortError" && signal?.aborted) throw error;
            this.logger.warn(`Candidate download failed from ${candidate.user}`, { error });
            onUpdate?.(
                {
                    state: "failed",
                    provider: "soulseek",
                    track: trackMetadata,
                    downloadedAt: new Date(),
                    selected: false,
                    ...this.candidateStub(candidate),
                    query,
                },
                { attemptId }
            );
            return null;
        } finally {
            signal?.removeEventListener("abort", onOuterAbort);
        }
    }

    /**
     * Manually retry one specific previously-found candidate — e.g. a "skipped" or
     * "failed" row the user wants downloaded anyway. `retryPayload` is the exact
     * search result this service attached to that row earlier.
     */
    async retryCandidate(
        trackMetadata: TrackMetadata,
        retryPayload: unknown,
        onUpdate?: DownloadUpdateCallback,
        signal?: AbortSignal
    ): Promise<TrackDownloadSource> {
        const candidate = retryPayload as Candidate;
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
            ...this.candidateStub(candidate),
            query: this.queryFields(trackMetadata, extension),
        };
    }

    private async finalizeDownload(
        trackMetadata: TrackMetadata,
        filePath: string,
        extension: Extension,
        candidate?: Candidate
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
            fileInfo = await readFileInfo(
                filePath,
                trackMetadata.duration ?? 0,
                extension === "flac" ? "lossless" : "lossy"
            );
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
            ...(candidate ? this.candidateStub(candidate) : {}),
            query: this.queryFields(trackMetadata, extension),
        };
    }
}
