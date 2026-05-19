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
     * Download a track and return download source
     * @param trackMetadata The track metadata to download
     * @returns Array of track download sources (only one element for now)
     */
    abstract downloadTrack(trackMetadata: TrackMetadata): Promise<TrackDownloadSource>;
}
