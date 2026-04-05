import path from 'path';
import { CACHE_DIR } from '../../constants';
import { globalLogger } from '../../base/logger/logger';
import { loadJsonFile, saveJsonFile } from '../../utils/json';
import { sleep } from '../../utils/sleep';

const SONGLINK_API_BASE_URL = "https://api.song.link/v1-alpha.1/links";
const SONGLINK_RATE_PATH = path.join(CACHE_DIR, 'songlink_rate.json');
const SONGLINK_RATE_LIMIT = 10; // requests
const SONGLINK_RATE_WINDOW_MS = 60_000; // per 60 seconds

// All possible platform identifiers
export type Platform =
    | 'spotify'
    | 'itunes'
    | 'appleMusic'
    | 'youtube'
    | 'youtubeMusic'
    | 'google'
    | 'googleStore'
    | 'pandora'
    | 'deezer'
    | 'tidal'
    | 'amazonStore'
    | 'amazonMusic'
    | 'soundcloud'
    | 'napster'
    | 'yandex'
    | 'spinrilla'
    | 'audius'
    | 'audiomack'
    | 'anghami'
    | 'boomplay'
    | 'bandcamp';

// All possible API provider identifiers
export type APIProvider =
    | 'spotify'
    | 'itunes'
    | 'youtube'
    | 'google'
    | 'pandora'
    | 'deezer'
    | 'tidal'
    | 'amazon'
    | 'soundcloud'
    | 'napster'
    | 'yandex'
    | 'spinrilla'
    | 'audius'
    | 'audiomack'
    | 'anghami'
    | 'boomplay'
    | 'bandcamp';

// Describes a single link object within linksByPlatform
export type PlatformLink = {
    country: string;
    entityUniqueId: string;
    url: string;
    nativeAppUriMobile?: string;
    nativeAppUriDesktop?: string;
};

// Describes a single entity object within entitiesByUniqueId
export type Entity = {
    id: string;
    type: 'song' | 'album';
    title?: string;
    artistName?: string;
    thumbnailUrl?: string;
    thumbnailWidth?: number;
    thumbnailHeight?: number;
    apiProvider: APIProvider;
    platforms: Platform[];
};


// The main structure of the JSON response from the API
// Source: https://linktree.notion.site/API-d0ebe08a5e304a55928405eb682f6741
export type SonglinkResponse = {
    entityUniqueId: string;
    userCountry: string;
    pageUrl: string;
    linksByPlatform: Partial<Record<Platform, PlatformLink>>;
    entitiesByUniqueId: Record<string, Entity>;
};


/**
 * Handles raw API communication with the Song.link API.
 * This class is responsible for managing the base URL and
 * enforcing rate limits centrally.
 */
export class SonglinkClient {
    constructor() { }

    /**
     * Performs a GET request to the Song.link API, automatically handling rate limits.
     * @param queryParams The URLSearchParams for the request.
     * @returns The API response or null if an error occurred.
     */
    public async get(queryParams: URLSearchParams): Promise<SonglinkResponse | null> {
        try {
            // 1. Ensure rate limit is respected
            await this.ensureRateLimit();

            // 2. Fetch from API
            const fullUrl = `${SONGLINK_API_BASE_URL}?${queryParams}`;
            const response = await fetch(fullUrl);

            if (!response.ok) {
                globalLogger.error(`SonglinkClient HTTP error! Status: ${response.status} for URL: ${fullUrl}`);
                throw new Error(`HTTP error! Status: ${response.status}`);
            }

            // 3. Parse and return data
            return await response.json() as SonglinkResponse;

        } catch (error) {
            globalLogger.error('SonglinkClient failed to fetch data:', { error: error instanceof Error ? error.message : error });
            return null;
        }
    }

    /**
     * Checks and enforces the API rate limit, waiting if necessary.
     * This logic is moved directly from the service.
     */
    private async ensureRateLimit(): Promise<void> {
        const now = Date.now();
        let rateLog: number[] = await loadJsonFile<number[]>(SONGLINK_RATE_PATH, []);

        // Filter out timestamps older than the window
        rateLog = rateLog.filter(ts => now - ts < SONGLINK_RATE_WINDOW_MS);

        if (rateLog.length >= SONGLINK_RATE_LIMIT) {
            const oldest = rateLog[0];
            const waitMs = SONGLINK_RATE_WINDOW_MS - (now - oldest) + 50; // +50ms buffer
            globalLogger.info(`Rate limit reached for Songlink API. Waiting ${Math.ceil(waitMs / 1000)}s…`);
            await sleep(waitMs);

            // Re-filter log after waiting
            const now2 = Date.now();
            rateLog = rateLog.filter(ts => now2 - ts < SONGLINK_RATE_WINDOW_MS);
        }

        // Log the new request timestamp and save
        rateLog.push(Date.now());
        await saveJsonFile(SONGLINK_RATE_PATH, rateLog);
    }
}
