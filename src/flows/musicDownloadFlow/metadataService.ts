import { ServiceBase } from "#base/service-base";
import { Task } from "#base/task/task";
import { Logger } from "#base/logger/logger";
import { ParsedUrl, CollectionExpansion } from "#base/urlParser";
import { TrackMetadata, SearchTrackResult } from "./types";
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

    /**
     * Optional capability: resolve an album/playlist URL to its track listing.
     * Services opt in by overriding this static — recognition (resolveCollectionRecognition)
     * only requires parseUrl, but a CollectionTask can only actually fetch a listing
     * when the recognizing service also implements this. `task` is the CollectionTask
     * driving the fetch — only Task-shaped (not a DownloadTask), passed through so an
     * implementation can reuse its instance methods (auth prompts, status) via a
     * same-class cast rather than duplicating them in a static context.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    static expandCollection?(url: string, logger: Logger, task: Task<any>): Promise<CollectionExpansion>;

    getType(url: string): "track" | undefined {
        return (this.constructor as typeof MetadataService).parseUrl?.(url)?.type === "track" ? "track" : undefined;
    }

    abstract getTrackMetadata(url: string): Promise<TrackMetadata>;
    abstract searchTrack(sourceTrackMetadata: TrackMetadata): Promise<SearchTrackResult[]>;
}
