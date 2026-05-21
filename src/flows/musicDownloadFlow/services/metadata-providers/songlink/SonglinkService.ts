import { Logger } from "#base/logger/logger";
import { ProviderDisplay } from "#base/providerDisplay";
import { ProviderSettingsSchema } from "#base/providerSettings";
import { ParsedUrl } from "#base/urlParser";
import { StatusType } from "#base/task/task-status";
import { Cached } from "#utils/cache";
import { DiscoveryMetadataService } from "../../../discoveryMetadataService";
import { SonglinkClient, SonglinkResponse } from "../../apis/songlink-client";
import type { APIProvider as SonglinkAPIProvider, Platform as SonglinkPlatform } from "../../apis/songlink-client";
import { TrackMetadata, APIProvider, Platform } from "#flows/musicDownloadFlow/types";
import { DownloadTask } from "#flows/musicDownloadFlow/utils/downloadTask";

const STUB_PRIORITY: SonglinkAPIProvider[] = ["spotify", "itunes", "tidal", "deezer", "soundcloud", "youtube"];

type StubParams = {
    id: string;
    trackName: string;
    artistName?: string;
    url: string;
    platform: Platform;
    apiProvider: APIProvider;
    nativeAppUriMobile?: string;
    nativeAppUriDesktop?: string;
};

export class SonglinkService extends DiscoveryMetadataService {
    static readonly display: ProviderDisplay = {
        label: "SongLink",
        acronym: "SONGLINK",
        color: "#e7652b",
        colorSubtle: "#7a3010",
        colorBright: "#ff7740",
    };
    static readonly defaultSettings: ProviderSettingsSchema = {
        enabled: { label: "Enable", defaultValue: true, kind: "checkbox" },
    };

    private static client: SonglinkClient;

    constructor(task: DownloadTask, logger: Logger) {
        super("SonglinkService", task, logger);
    }

    /** Catch-all: SongLink can look up any HTTP(S) URL. */
    static parseUrl(url: string): ParsedUrl | null {
        try {
            const parsed = new URL(url);
            if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
            return { platform: "songlink", type: "track" };
        } catch {
            return null;
        }
    }

    private async getClient(): Promise<SonglinkClient> {
        return this.runExclusive("init", async () => {
            if (!SonglinkService.client) {
                SonglinkService.client = new SonglinkClient();
            }
            return SonglinkService.client;
        });
    }

    @Cached()
    async fetchSonglinkData(url: string): Promise<SonglinkResponse | null> {
        const client = await this.getClient();

        this.logger.info(`Fetching SongLink data for: "${url}"`);
        this.status.set({
            type: StatusType.Processing,
            message: "Fetching SongLink data",
            timeTracking: true,
            progress: 0,
        });

        try {
            const queryParams = new URLSearchParams({
                url,
                userCountry: "FR",
                songIfSingle: "true",
            });

            this.status.update({ progress: 20 });
            const data = await client.get(queryParams);
            this.status.update({ progress: 100 });

            if (!data) throw new Error("SongLink returned no data");

            this.logger.info("SongLink data fetched successfully");
            return data;
        } catch (error) {
            this.logger.error(`Error fetching SongLink data for ${url}`, { error });
            this.status.set({ type: StatusType.Error, message: "Error fetching SongLink data" });
            throw error;
        }
    }

    /**
     * Rôle 1 & 2 — Primary fetch fallback.
     * Returns the best available stub from the SongLink response.
     */
    async getTrackMetadata(url: string): Promise<TrackMetadata> {
        const data = await this.fetchSonglinkData(url);
        if (!data) throw new Error("Failed to fetch SongLink data");

        for (const provider of STUB_PRIORITY) {
            const entityEntry = Object.entries(data.entitiesByUniqueId).find(
                ([, entity]) => entity.apiProvider === provider
            );
            if (!entityEntry) continue;

            const [entityUniqueId, entity] = entityEntry;
            const platformEntry = Object.entries(data.linksByPlatform).find(
                ([, link]) => link?.entityUniqueId === entityUniqueId
            );

            const entityUrl = platformEntry?.[1]?.url ?? data.pageUrl;
            const platform = (platformEntry?.[0] ?? provider) as Platform;

            return this.buildStub({
                id: entity.id,
                trackName: entity.title ?? "Unknown Track",
                artistName: entity.artistName,
                url: entityUrl,
                platform,
                apiProvider: provider as APIProvider,
                nativeAppUriMobile: platformEntry?.[1]?.nativeAppUriMobile,
                nativeAppUriDesktop: platformEntry?.[1]?.nativeAppUriDesktop,
            });
        }

        // Last resort: return a songlink-platform stub using the page URL
        const firstEntity = Object.values(data.entitiesByUniqueId)[0];
        return this.buildStub({
            id: data.entityUniqueId,
            trackName: firstEntity?.title ?? "Unknown Track",
            artistName: firstEntity?.artistName,
            url: data.pageUrl,
            platform: "songlink",
            apiProvider: "songlink",
        });
    }

    /**
     * Rôle 3 — Discovery.
     * Returns one stub per platform found by SongLink, excluding the source platform.
     */
    async discoverTracks(source: TrackMetadata): Promise<TrackMetadata[]> {
        const data = await this.fetchSonglinkData(source.url);
        if (!data) return [];

        const stubs: TrackMetadata[] = [];
        const seenPlatforms = new Set<string>([source.platform, source.apiProvider]);

        for (const [platformKey, link] of Object.entries(data.linksByPlatform)) {
            if (!link) continue;
            const platform = platformKey as SonglinkPlatform;
            if (seenPlatforms.has(platform)) continue;

            const entity = data.entitiesByUniqueId[link.entityUniqueId];
            if (!entity) continue;

            seenPlatforms.add(platform);

            stubs.push(
                this.buildStub({
                    id: entity.id,
                    trackName: entity.title ?? source.trackName,
                    artistName: entity.artistName ?? source.artists[0]?.name,
                    url: link.url,
                    platform: platform as Platform,
                    apiProvider: entity.apiProvider as APIProvider,
                    nativeAppUriMobile: link.nativeAppUriMobile,
                    nativeAppUriDesktop: link.nativeAppUriDesktop,
                })
            );
        }

        return stubs;
    }

    private buildStub({
        id,
        trackName,
        artistName,
        url,
        platform,
        apiProvider,
        nativeAppUriMobile,
        nativeAppUriDesktop,
    }: StubParams): TrackMetadata {
        const artists = artistName
            ? artistName
                  .split(/[,&]+/)
                  .map((name) => ({ type: "artist" as const, name: name.trim() }))
                  .filter((a) => a.name.length > 0)
            : [];

        return {
            id,
            trackName,
            url,
            artists,
            platform,
            apiProvider,
            fetchedAt: new Date(),
            type: "track",
            fetchedVia: "songlink",
            ...(nativeAppUriMobile && { nativeAppUriMobile }),
            ...(nativeAppUriDesktop && { nativeAppUriDesktop }),
        } as unknown as TrackMetadata;
    }
}
