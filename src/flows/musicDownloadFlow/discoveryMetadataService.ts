import { ServiceBase } from "#base/service-base";
import { Logger } from "#base/logger/logger";
import { TrackMetadata, DiscoveryResult } from "./types";
import { DownloadTask } from "./utils/downloadTask";

export abstract class DiscoveryMetadataService extends ServiceBase {
    constructor(serviceName: string, task: DownloadTask, logger: Logger) {
        super(serviceName, task, logger);
    }

    // Returns discovered TrackMetadata objects for each platform plus an optional anchor
    // (the provider's own URL/identifier for Copy/Open actions).
    abstract discoverFromUri(sourceMetadata: TrackMetadata): Promise<DiscoveryResult>;
}
