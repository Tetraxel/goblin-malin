import { ServiceBase } from "#base/service-base";
import { Logger } from "#base/logger/logger";
import { TrackMetadata } from "./types";
import { DownloadTask } from "./utils/downloadTask";

export abstract class DiscoveryMetadataService extends ServiceBase {
    constructor(serviceName: string, task: DownloadTask, logger: Logger) {
        super(serviceName, task, logger);
    }

    // Returns rudimentary TrackMetadata objects for each discovered platform.
    // Each result has fetchedBy set to this service's key and sparse fields.
    abstract discoverFromUri(sourceMetadata: TrackMetadata): Promise<TrackMetadata[]>;
}
