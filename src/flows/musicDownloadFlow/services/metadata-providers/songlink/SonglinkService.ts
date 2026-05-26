import { Logger } from "#base/logger/logger";
import { ProviderDisplay } from "#base/providerDisplay";
import { ProviderSettingsSchema } from "#base/providerSettings";
import { StatusType } from "#base/task/task-status";
import { Cached } from "#utils/cache";
import { TrackMetadata } from "#flows/musicDownloadFlow/types";
import { DiscoveryMetadataService } from "#flows/musicDownloadFlow/discoveryMetadataService";
import { DownloadTask } from "#flows/musicDownloadFlow/utils/downloadTask";
import { SonglinkClient } from "../../apis/songlink-client";
import { extractTracksFromSonglinkResponse } from "./convertSonglinkToTrack";

export class SonglinkService extends DiscoveryMetadataService {
    static readonly display: ProviderDisplay = {
        label: "Songlink",
        acronym: "SONGLINK",
        color: "#f76c1b",
        colorSubtle: "#7a3000",
        colorBright: "#ff8c3a",
    };
    static readonly defaultSettings: ProviderSettingsSchema = {
        enabled: { label: "Enable", defaultValue: true, kind: "checkbox" },
    };

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
    async discoverFromUri(sourceMetadata: TrackMetadata): Promise<TrackMetadata[]> {
        const url = sourceMetadata.url;
        if (!url) return [];

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

            return extractTracksFromSonglinkResponse(data);
        } catch (error) {
            this.logger.error(`Error discovering via Songlink for: ${url}`, { error });
            this.status.set({ type: StatusType.Error, message: "Error discovering via Songlink" });
            throw error;
        }
    }
}
