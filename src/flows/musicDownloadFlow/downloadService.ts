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
     *                 returned value is the final, canonical source.
     * @returns The completed track download source
     */
    abstract downloadTrack(
        trackMetadata: TrackMetadata,
        onUpdate?: (source: TrackDownloadSource) => void,
        signal?: AbortSignal
    ): Promise<TrackDownloadSource>;
}
