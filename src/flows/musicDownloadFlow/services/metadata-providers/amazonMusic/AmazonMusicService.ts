import { type Logger } from "#base/logger/logger";
import { type ParsedUrl } from "#base/urlParser";
import { StatusType } from "#base/task/task-status";
import { type ProviderDisplay } from "#base/providerDisplay";
import { type ProviderConsent, type ProviderSettingsSchema } from "#base/providerSettings";
import { type DownloadTask } from "#flows/musicDownloadFlow/utils/downloadTask";
import { type TrackMetadata, type SearchTrackResult } from "#flows/musicDownloadFlow/types";
import { createProviderIdCell } from "../../../columns/ProviderIdCell";
import { Cached } from "#utils/cache";
import { MetadataService } from "../../../metadataService";
import { SonglinkClient } from "../../apis/songlink-client";
import { amazonSongFromSonglink, convertAmazonMusicToTrack, type AmazonMusicSong } from "./convertAmazonMusicToTrack";
import { amazonMusicTrackUrl, parseAmazonMusicUrl } from "./amazonMusicUrl";

/**
 * Amazon Music. Its pages are drawn in the browser (they hold no data without JavaScript) and its API is closed, so
 * a track is read through Songlink (api.song.link), which knows Amazon Music: the link is sent there. That is why this
 * provider is off until the user turns it on (`consent`), and why it spends Songlink's small hourly quota. It does not
 * search: an Amazon Music link comes from the user, or from Songlink's discovery of a track.
 * Amazon Music streams are DRM-protected: no download provider of the app reads them (Soulseek searches by name).
 */
export class AmazonMusicService extends MetadataService {
    static readonly display: ProviderDisplay = {
        label: "Amazon Music",
        acronym: "AZ",
        color: "#25d1da",
        colorSubtle: "#0d4f53",
        colorBright: "#5ee6ee",
    };
    static readonly summary = "Reads Amazon Music track links through Songlink: each link is sent to song.link.";
    static readonly defaultSettings: ProviderSettingsSchema = {
        enabled: { label: "Enable", defaultValue: false, kind: "checkbox" },
    };
    static readonly consent: ProviderConsent = {
        title: "Read Amazon Music links through Songlink?",
        message:
            "Amazon Music has no public way to read a track, so the app asks Songlink (song.link): each Amazon Music " +
            "link is sent to api.song.link, and it uses Songlink's free quota (about 19 lookups per hour).",
    };
    static readonly cellComponent = createProviderIdCell("amazonMusic");
    static readonly trackUrl = amazonMusicTrackUrl;

    private static client: SonglinkClient | undefined;

    constructor(task: DownloadTask, logger: Logger) {
        super("AmazonMusicService", task, logger);
    }

    static parseUrl(url: string): ParsedUrl | null {
        return parseAmazonMusicUrl(url);
    }

    /** What Songlink knows about the track. Cached as plain data: a lookup spends Songlink's hourly quota. */
    @Cached()
    private async lookup(asin: string): Promise<AmazonMusicSong> {
        this.logger.info(`Reading Amazon Music track through Songlink: ${asin}`);
        AmazonMusicService.client ??= new SonglinkClient();
        const response = await AmazonMusicService.client.get(
            new URLSearchParams({ url: amazonMusicTrackUrl(asin), songIfSingle: "true" })
        );
        const song = response ? amazonSongFromSonglink(response, asin) : null;
        if (!song) throw new Error(`Songlink does not know the Amazon Music track ${asin}`);
        return song;
    }

    async getTrackMetadata(url: string): Promise<TrackMetadata> {
        const parsed = parseAmazonMusicUrl(url);
        if (parsed?.type !== "track" || !parsed.id) throw new Error(`Invalid Amazon Music track URL: ${url}`);

        this.status.set({ type: StatusType.Processing, message: "Fetching Amazon Music track", timeTracking: true });
        try {
            const metadata = convertAmazonMusicToTrack(await this.lookup(parsed.id), parsed.id);
            if (!metadata) throw new Error(`Songlink gave no title for the Amazon Music track ${parsed.id}`);
            this.status.clear();
            return metadata;
        } catch (error) {
            this.logger.error("Error getting Amazon Music track:", { error });
            this.status.set({ type: StatusType.Error, message: "Error fetching Amazon Music track" });
            throw error;
        }
    }

    /** Amazon Music cannot be searched without an account: its tracks come from a pasted link or from discovery. */
    async searchTrack(sourceTrackMetadata: TrackMetadata): Promise<SearchTrackResult[]> {
        if (!sourceTrackMetadata.artists?.[0]?.name || !sourceTrackMetadata.trackName) {
            throw new Error("Artist name and track name are required for search");
        }
        this.logger.debug("Amazon Music has no public search: its link comes from Songlink");
        return [];
    }
}
