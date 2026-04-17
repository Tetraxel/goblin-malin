import { ServiceBase } from '../../base/service-base';
import { Task } from '../../base/task/task';
import { Logger } from '../../base/logger/logger';
import { TrackMetadata } from './types';
import { DownloadTask } from './utils/downloadTask';

/**
 * Abstract base class for metadata providers.
 * Handles fetching and searching track metadata from various sources.
 */
export abstract class MetadataService extends ServiceBase {
    constructor(serviceName: string, task: DownloadTask, logger: Logger) {
        super(serviceName, task, logger);
    }

    /**
     * Get the type of content at a URL
     * @param url The URL to check
     * @returns 'track' if it's a track URL, undefined otherwise
     */
    abstract getType(url: string): 'track' | undefined;

    /**
     * Get track metadata from a URL
     * @param url The track URL
     * @returns Track metadata
     */
    abstract getTrackMetadata(url: string): Promise<TrackMetadata>;

    /**
     * Search for track metadata based on source metadata
     * @param sourceTrackMetadata The source track metadata to search for
     * @returns Enhanced track metadata
     */
    abstract searchTrack(sourceTrackMetadata: TrackMetadata): Promise<TrackMetadata>;
}
