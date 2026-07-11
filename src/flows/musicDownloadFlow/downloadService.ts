import { ServiceBase } from "#base/service-base";
import { Logger } from "#base/logger/logger";
import { TrackMetadata, TrackDownloadSource, APIProvider } from "./types";
import { DownloadTask } from "./utils/downloadTask";

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
     * @returns The completed track download source
     */
    abstract downloadTrack(
        trackMetadata: TrackMetadata,
        onUpdate?: (source: TrackDownloadSource, options?: { attemptId?: string }) => void,
        signal?: AbortSignal
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
        onUpdate?: (source: TrackDownloadSource, options?: { attemptId?: string }) => void,
        signal?: AbortSignal
    ): Promise<TrackDownloadSource>;
}
