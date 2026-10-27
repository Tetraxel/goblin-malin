import { ServiceBase } from "#base/service-base";
import { Logger } from "#base/logger/logger";
import { TrackMetadata, DiscoveryResult, Platform } from "./types";
import { DownloadTask } from "./utils/downloadTask";

// What the pipeline already knows when it calls a discovery service.
export type DiscoveryContext = {
    // Platforms that still have no result for this track (and whose metadata service is enabled).
    // A text-based service can restrict its search to these; URL-based ones (Songlink) ignore it.
    wantedPlatforms?: Platform[];
};

export abstract class DiscoveryMetadataService extends ServiceBase {
    constructor(serviceName: string, task: DownloadTask, logger: Logger) {
        super(serviceName, task, logger);
    }

    // Returns discovered TrackMetadata objects for each platform plus an optional anchor
    // (the provider's own URL/identifier for Copy/Open actions).
    // Every returned track must set `fetchedBy` to the service's own registry key.
    abstract discoverFromUri(sourceMetadata: TrackMetadata, context?: DiscoveryContext): Promise<DiscoveryResult>;
}
