import path from "path";
import { getCacheDir } from "#utils/appPaths";
import { globalLogger } from "#base/logger/logger";
import { loadJsonFile, saveJsonFile } from "../metadata-providers/songlink/json";
import { sleep } from "#utils/sleep";

const SONGLINK_API_BASE_URL = "https://api.song.link/v1-alpha.1/links";
const SONGLINK_RATE_PATH = path.join(getCacheDir(), "songlink_rate.json");

// ── Songlink rate limit (measured empirically — see scripts/songlink-rate-probe.mjs) ──
// The real limit is NOT the documented "10 req/min". It is a FIXED hourly quota of ~20
// SUCCESSFUL requests, reset at the top of each clock hour (UTC). Only 2xx responses count
// (429s are free); once the quota is spent every request returns 429 until HH:00, and there is
// no `Retry-After` header. Spacing requests out does NOT help — it's a hard hourly cap.
const SONGLINK_HOURLY_LIMIT = 19; // we consistently observed 19 successful calls per clock hour
const HOUR_MS = 3_600_000;

// Retries apply ONLY to transient (non-429) failures — network errors / 5xx. A 429 means the
// hourly quota is gone and retrying within the same hour is futile, so we throw immediately.
const SONGLINK_MAX_ATTEMPTS = 6; // total attempts for transient errors
const SONGLINK_BACKOFF_BASE_MS = 1_000; // first retry backoff; doubles each attempt
const SONGLINK_BACKOFF_MAX_MS = 10_000; // cap a single backoff

/** Thrown when the Songlink hourly quota is exhausted (proactively, or on a 429 response). */
export class SonglinkRateLimitError extends Error {
    constructor(resetInMinutes?: number) {
        const resets =
            resetInMinutes != null
                ? `resets in ~${resetInMinutes} min (top of the hour)`
                : "resets at the top of the hour";
        super(`Songlink hourly rate limit reached (~${SONGLINK_HOURLY_LIMIT}/hour); ${resets}`);
        this.name = "SonglinkRateLimitError";
    }
}

// All possible platform identifiers
export type Platform =
    | "spotify"
    | "itunes"
    | "appleMusic"
    | "youtube"
    | "youtubeMusic"
    | "google"
    | "googleStore"
    | "pandora"
    | "deezer"
    | "tidal"
    | "amazonStore"
    | "amazonMusic"
    | "soundcloud"
    | "napster"
    | "yandex"
    | "spinrilla"
    | "audius"
    | "audiomack"
    | "anghami"
    | "boomplay"
    | "bandcamp";

// All possible API provider identifiers
export type APIProvider =
    | "spotify"
    | "itunes"
    | "youtube"
    | "google"
    | "pandora"
    | "deezer"
    | "tidal"
    | "amazon"
    | "soundcloud"
    | "napster"
    | "yandex"
    | "spinrilla"
    | "audius"
    | "audiomack"
    | "anghami"
    | "boomplay"
    | "bandcamp";

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
    type: "song" | "album";
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
 * Handles raw API communication with the Song.link API: builds the request URL, enforces the
 * rate limit centrally, and retries transient errors.
 *
 * ⚠️ RATE LIMIT (measured, not documented): ~{@link SONGLINK_HOURLY_LIMIT} SUCCESSFUL requests
 * per clock hour (UTC), reset at HH:00. Only 2xx responses consume the quota; once it is spent
 * every call returns 429 until the next hour. See {@link SonglinkRateLimitError} and
 * scripts/songlink-rate-probe.mjs.
 *
 * Concurrency: instances share process-wide static state so the quota holds across all parallel
 * tasks. The success counter is read-modified-written through a single async mutex
 * ({@link SonglinkClient.lock}) so concurrent callers can't race it, and is persisted to disk so
 * a relaunch keeps the running hourly count.
 */
export class SonglinkClient {
    // Timestamps (epoch ms) of SUCCESSFUL requests in the current clock hour — the server only
    // counts 2xx. Lazily hydrated from disk once; re-persisted after each success.
    private static successLog: number[] | null = null;
    // Serializes the quota check / record across all callers (a chained-promise mutex).
    private static lock: Promise<void> = Promise.resolve();

    constructor() {}

    /**
     * Performs a GET request to the Song.link API.
     * @param queryParams The URLSearchParams for the request.
     * @returns The API response.
     * @throws {SonglinkRateLimitError} when the hourly quota is exhausted (proactively or on a 429).
     * @throws {Error} on other HTTP/network errors after {@link SONGLINK_MAX_ATTEMPTS} attempts.
     */
    public async get(queryParams: URLSearchParams): Promise<SonglinkResponse | null> {
        const fullUrl = `${SONGLINK_API_BASE_URL}?${queryParams}`;

        for (let attempt = 1; attempt <= SONGLINK_MAX_ATTEMPTS; attempt++) {
            // Proactive guard: don't even send if this clock hour's quota is already spent.
            await this.ensureHourlyQuota();

            let response: Response;
            try {
                response = await fetch(fullUrl);
            } catch (error) {
                // Transient network error → retry with backoff.
                if (attempt < SONGLINK_MAX_ATTEMPTS) {
                    const waitMs = this.backoff(attempt);
                    globalLogger.warn(
                        `SonglinkClient fetch failed (attempt ${attempt}/${SONGLINK_MAX_ATTEMPTS}); retrying in ${Math.ceil(waitMs / 1000)}s`,
                        { error: error instanceof Error ? error.message : error }
                    );
                    await sleep(waitMs);
                    continue;
                }
                throw error;
            }

            // 429 = hourly quota gone server-side. Retrying won't help until the next clock hour,
            // so fail fast with a clear error instead of looping.
            if (response.status === 429) {
                globalLogger.error(`SonglinkClient got 429 (hourly limit reached) for URL: ${fullUrl}`);
                throw new SonglinkRateLimitError(this.minutesUntilReset());
            }

            // Other HTTP errors (5xx, etc.) → retry.
            if (!response.ok) {
                if (attempt < SONGLINK_MAX_ATTEMPTS) {
                    const waitMs = this.backoff(attempt);
                    globalLogger.warn(
                        `SonglinkClient HTTP ${response.status} (attempt ${attempt}/${SONGLINK_MAX_ATTEMPTS}); retrying in ${Math.ceil(waitMs / 1000)}s`
                    );
                    await sleep(waitMs);
                    continue;
                }
                globalLogger.error(`SonglinkClient HTTP error! Status: ${response.status} for URL: ${fullUrl}`);
                throw new Error(`HTTP error! Status: ${response.status}`);
            }

            const data = (await response.json()) as SonglinkResponse;
            await this.recordSuccess(); // only 2xx consume the quota
            return data;
        }

        // Unreachable: the loop always returns or throws. Present to satisfy the type checker.
        return null;
    }

    /**
     * Proactively enforce the hourly quota. Serialized so concurrent callers share one accurate
     * count. Throws {@link SonglinkRateLimitError} when this clock hour's quota is already spent —
     * no point sending a request that would just 429 until the top of the hour.
     */
    private async ensureHourlyQuota(): Promise<void> {
        const run = SonglinkClient.lock.then(async () => {
            const log = await this.pruneToCurrentHour();
            if (log.length >= SONGLINK_HOURLY_LIMIT) {
                throw new SonglinkRateLimitError(this.minutesUntilReset());
            }
        });
        // Keep the chain alive even if this check throws, so the lock never deadlocks.
        SonglinkClient.lock = run.then(
            () => undefined,
            () => undefined
        );
        return run;
    }

    /** Records a successful request against the current hour's quota and persists it. */
    private async recordSuccess(): Promise<void> {
        const run = SonglinkClient.lock.then(async () => {
            const log = await this.pruneToCurrentHour();
            log.push(Date.now());
            SonglinkClient.successLog = log;
            await saveJsonFile(SONGLINK_RATE_PATH, log);
        });
        SonglinkClient.lock = run.then(
            () => undefined,
            () => undefined
        );
        return run;
    }

    /**
     * Drops success timestamps from previous clock hours and returns the in-memory log (hydrating
     * it from disk on first use). Only ever called under {@link SonglinkClient.lock}.
     */
    private async pruneToCurrentHour(): Promise<number[]> {
        if (SonglinkClient.successLog === null) {
            SonglinkClient.successLog = await loadJsonFile<number[]>(SONGLINK_RATE_PATH, []);
        }
        const hourStart = Date.now() - (Date.now() % HOUR_MS); // top of the current UTC hour
        SonglinkClient.successLog = SonglinkClient.successLog.filter((ts) => ts >= hourStart);
        return SonglinkClient.successLog;
    }

    /** Minutes until the hourly quota resets (top of the next clock hour). */
    private minutesUntilReset(): number {
        const now = Date.now();
        const nextHour = now - (now % HOUR_MS) + HOUR_MS;
        return Math.ceil((nextHour - now) / 60_000);
    }

    /** Exponential backoff with jitter for transient retries, capped at {@link SONGLINK_BACKOFF_MAX_MS}. */
    private backoff(attempt: number): number {
        const exp = SONGLINK_BACKOFF_BASE_MS * 2 ** (attempt - 1);
        const jitter = Math.floor(Math.random() * 500);
        return Math.min(exp + jitter, SONGLINK_BACKOFF_MAX_MS);
    }
}
