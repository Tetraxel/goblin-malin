import { ServiceBase } from "#base/service-base";
import { type Logger } from "#base/logger/logger";
import { type TrackMetadata, type TrackDownloadSource, type APIProvider } from "./types";
import { type DownloadTask } from "./utils/downloadTask";

export type DownloadUpdateOptions = {
    attemptId?: string;
    /**
     * Lets the caller cancel *this specific* in-flight attempt on demand (e.g. the
     * user rejects this row while it's downloading) — distinct from the `signal`
     * passed into `downloadTrack`/`retryCandidate`, which cancels everything.
     * Only meaningful while the row is actively in flight; omit once it settles
     * into a terminal state.
     */
    abort?: () => void;
};

/** What the user's download strategy (Settings → Download) asks of one `downloadTrack` call. */
export type DownloadTrackOptions = {
    /**
     * The most files this call may download for the track (1 when the options are left out). A provider that
     * finds several candidates (e.g. Soulseek) may keep going after a success until it has this many; one that
     * can only produce a single file (e.g. yt-dlp) ignores it. Never exceeded, never above `MAX_DOWNLOADS_PER_PROVIDER`.
     */
    maxDownloads: number;
};

export type DownloadUpdateCallback = (source: TrackDownloadSource, options?: DownloadUpdateOptions) => void;

/**
 * Abstract base class for download providers.
 * Handles downloading tracks from various sources.
 */
export abstract class DownloadService extends ServiceBase {
    abstract compatibleMetadataProviders: APIProvider[];

    /**
     * True for a provider that finds files by free-text search (artist/title) rather
     * than resolving a specific metadata source's URL (e.g. Soulseek — any metadata
     * group could have supplied the search terms). When true, `startDownloads()`
     * builds this service's `trackMetadata` from the task's *compiled* metadata
     * (merged across sources, with user overrides applied) instead of an otherwise
     * arbitrary single group's raw result — that's a more honest reflection of what
     * was actually searched for, and stays correct if the user edits a field.
     */
    public readonly usesCompiledMetadataForQuery: boolean = false;

    constructor(serviceName: string, task: DownloadTask, logger: Logger) {
        super(serviceName, task, logger);
    }

    public canDownload(trackMetadata: TrackMetadata): boolean {
        return this.compatibleMetadataProviders.includes(trackMetadata.apiProvider);
    }

    /**
     * Download a track and return the final download source.
     * @param trackMetadata The track metadata to download
     * @param onUpdate Called with intermediate sources (e.g. "downloading" + progress)
     *                 so the UI can show progress before the download completes. The
     *                 returned value is the final, canonical source, applied to whichever
     *                 row the *last* onUpdate call addressed (see `attemptId`).
     *
     *                 By default (no `attemptId`) every call updates the same single row,
     *                 which is all most services (e.g. yt-dlp) need. A service that tries
     *                 several candidates for one track (e.g. Soulseek working through a
     *                 ranked peer list) can give each candidate a stable `attemptId`: the
     *                 first onUpdate with a given id opens its own row, and later calls
     *                 with the same id update that exact row — independent of whichever
     *                 row was most recently touched. This lets a service show every real
     *                 attempt (pending/downloading/failed/downloaded) as its own row
     *                 instead of collapsing them into one shared status.
     * @param options See {@link DownloadTrackOptions}.
     * @returns The completed track download source (with several downloads: the last one reported)
     */
    abstract downloadTrack(
        trackMetadata: TrackMetadata,
        onUpdate?: DownloadUpdateCallback,
        signal?: AbortSignal,
        options?: DownloadTrackOptions
    ): Promise<TrackDownloadSource>;

    /**
     * Retry one specific previously-found candidate on demand — e.g. a Soulseek
     * source the user marked "skipped" or "failed" that they want tried anyway.
     * `retryPayload` is whatever opaque value this same service originally attached
     * to that source's `TrackDownloadSource.retryPayload`.
     *
     * Optional: only services that produce multiple distinguishable candidates for
     * one track need to implement this (e.g. yt-dlp has no such concept — its one
     * source *is* the track, so re-running `downloadTrack()` is already a full retry).
     */
    retryCandidate?(
        trackMetadata: TrackMetadata,
        retryPayload: unknown,
        onUpdate?: DownloadUpdateCallback,
        signal?: AbortSignal
    ): Promise<TrackDownloadSource>;
}
