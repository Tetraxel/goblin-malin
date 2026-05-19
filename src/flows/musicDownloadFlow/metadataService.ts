import { ServiceBase } from "#base/service-base";
import { Logger } from "#base/logger/logger";
import { ParsedUrl } from "#base/urlParser";
import { TrackMetadata } from "./types";
import { DownloadTask } from "./utils/downloadTask";

/**
 * Abstract base class for metadata providers.
 * Handles fetching and searching track metadata from various sources.
 */
export abstract class MetadataService extends ServiceBase {
    constructor(serviceName: string, task: DownloadTask, logger: Logger) {
        super(serviceName, task, logger);
    }

    static parseUrl(_url: string): ParsedUrl | null {
        throw new Error("Method not implemented!");
    }

    getType(url: string): "track" | undefined {
        return (this.constructor as typeof MetadataService).parseUrl?.(url)?.type === "track" ? "track" : undefined;
    }

    abstract getTrackMetadata(url: string): Promise<TrackMetadata>;
    abstract searchTrack(sourceTrackMetadata: TrackMetadata): Promise<TrackMetadata>;
}
