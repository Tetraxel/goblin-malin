import { Logger } from "#base/logger/logger";
import { ProviderDisplay } from "#base/providerDisplay";
import { ProviderSettingsSchema } from "#base/providerSettings";
import { StatusType } from "#base/task/task-status";
import { Cached } from "#utils/cache";
import type { TrackMetadata, DiscoveryResult } from "#flows/musicDownloadFlow/types";
import { DiscoveryMetadataService } from "#flows/musicDownloadFlow/discoveryMetadataService";
import { DownloadTask } from "#flows/musicDownloadFlow/utils/downloadTask";
import { SonglinkClient, SonglinkRateLimitError } from "../../apis/songlink-client";
import { extractTracksFromSonglinkResponse } from "./convertSonglinkToTrack";
import { SonglinkCell } from "./SonglinkCell";

/**
 * ⚠️⚠️  SONGLINK RATE LIMIT — READ BEFORE USING  ⚠️⚠️
 *
 * Song.link does NOT honor the "10 requests/minute" from its docs. Measured behavior
 * (scripts/songlink-rate-probe.mjs, multi-hour run) is a FIXED HOURLY QUOTA:
 *
 *   • ~19–20 SUCCESSFUL requests per clock hour, per IP.
 *   • The counter resets at the TOP OF THE CLOCK HOUR (HH:00 UTC) — not 60 min after the
 *     first call.
 *   • Only 2xx responses count; 429s are "free" and do NOT consume quota.
 *   • Once the quota is spent, EVERY request returns 429 until the next HH:00 (up to ~59 min).
 *   • There is NO `Retry-After` / rate-limit header — you cannot be told when to retry.
 *   • Spreading requests out does NOT help; it is a hard hourly cap, not a per-minute rate.
 *
 * Consequences for this service:
 *   • Discovering more than ~19 tracks within the same clock hour WILL start failing with
 *     {@link SonglinkRateLimitError}. The @Cached layer below absorbs repeats (cached results
 *     do not hit the API), so only first-time lookups count against the quota.
 *   • On the hourly limit, the client throws immediately instead of retrying (retrying inside
 *     the same hour is futile). Only transient network/5xx errors are retried (up to 6×).
 *
 * Enforcement lives centrally in SonglinkClient (../../apis/songlink-client.ts).
 */
export class SonglinkService extends DiscoveryMetadataService {
    static readonly display: ProviderDisplay = {
        label: "Songlink",
        acronym: "SL",
        color: "#f76c1b",
        colorSubtle: "#7a3000",
        colorBright: "#ff8c3a",
    };
    static readonly defaultSettings: ProviderSettingsSchema = {
        enabled: { label: "Enable", defaultValue: true, kind: "checkbox" },
    };
    static readonly cellComponent = SonglinkCell;

    private static client: SonglinkClient;

    constructor(task: DownloadTask, logger: Logger) {
        super("SonglinkService", task, logger);
    }

    private getClient(): SonglinkClient {
        if (!SonglinkService.client) {
            SonglinkService.client = new SonglinkClient();
        }
        return SonglinkService.client;
    }

    @Cached()
    async discoverFromUri(sourceMetadata: TrackMetadata): Promise<DiscoveryResult> {
        const url = sourceMetadata.url;
        if (!url) return { tracks: [], anchor: { state: "notFound" } };

        this.logger.info(`Discovering tracks via Songlink for: ${url}`);
        this.status.set({
            type: StatusType.Processing,
            message: "Discovering via Songlink",
            timeTracking: true,
            progress: 0,
        });

        try {
            const client = this.getClient();
            const queryParams = new URLSearchParams({
                url,
                userCountry: "FR",
                songIfSingle: "true",
            });

            const data = await client.get(queryParams);

            if (!data) {
                throw new Error("Songlink returned no data");
            }

            this.status.update({ progress: 100 });
            this.status.clear();

            const tracks = extractTracksFromSonglinkResponse(data);

            return {
                tracks,
                anchor: {
                    state: "found",
                    url: data.pageUrl,
                    openUri: data.pageUrl,
                    count: tracks.length,
                },
            };
        } catch (error) {
            this.logger.error(`Error discovering via Songlink for: ${url}`, { error });
            this.status.set({
                type: StatusType.Error,
                message:
                    error instanceof SonglinkRateLimitError
                        ? "Songlink hourly limit reached"
                        : "Error discovering via Songlink",
            });
            throw error;
        }
    }
}
