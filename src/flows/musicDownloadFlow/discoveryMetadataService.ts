import { ServiceBase } from "#base/service-base";
import { Logger } from "#base/logger/logger";
import { ParsedUrl } from "#base/urlParser";
import { TrackMetadata } from "./types";
import { DownloadTask } from "./utils/downloadTask";

/**
 * Abstract base class for discovery providers (e.g. SongLink).
 *
 * Unlike MetadataService, a discovery provider:
 *   - can act as a URL catch-all for primary metadata fetching
 *   - returns multiple platform stubs from a single source via discoverTracks()
 *   - does NOT implement searchTrack() or enrichTrack()
 */
export abstract class DiscoveryMetadataService extends ServiceBase {
    constructor(serviceName: string, task: DownloadTask, logger: Logger) {
        super(serviceName, task, logger);
    }

    static parseUrl(_url: string): ParsedUrl | null {
        return null;
    }

    getType(url: string): "track" | undefined {
        const parsed = (this.constructor as typeof DiscoveryMetadataService).parseUrl(url);
        return parsed?.type === "track" ? "track" : undefined;
    }

    abstract getTrackMetadata(url: string): Promise<TrackMetadata>;

    /**
     * Given a known primary source, returns TrackMetadata stubs for each
     * additional platform the discovery provider finds.  Stubs carry
     * fetchedVia: "songlink" and may be enriched later by native services.
     */
    abstract discoverTracks(source: TrackMetadata): Promise<TrackMetadata[]>;
}
