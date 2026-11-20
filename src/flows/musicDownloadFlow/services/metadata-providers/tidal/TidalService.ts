import { type Logger } from "#base/logger/logger";
import { type ParsedUrl } from "#base/urlParser";
import { StatusType } from "#base/task/task-status";
import { type ProviderDisplay } from "#base/providerDisplay";
import { type ProviderSettingsSchema } from "#base/providerSettings";
import { type DownloadTask } from "#flows/musicDownloadFlow/utils/downloadTask";
import { type TrackMetadata, type SearchTrackResult } from "#flows/musicDownloadFlow/types";
import { createProviderIdCell } from "../../../columns/ProviderIdCell";
import { Cached } from "#utils/cache";
import { fetchWithTimeout } from "#utils/timeout";
import { MetadataService } from "../../../metadataService";
import { convertTidalToTrack, extractTidalRecording, type TidalRecording } from "./convertTidalToTrack";
import { parseTidalUrl, tidalOpenUri, tidalTrackUrl } from "./tidalUrl";

/**
 * Tidal, read from the public page of a track (`tidal.com/track/<id>`), which describes it for search engines: title,
 * artists, album, duration and ISRC. No key and no account. Tidal's search needs an API key, so this service does not
 * search: a Tidal link pasted by the user is read, and so are the ones Songlink or MusicBrainz find for a track.
 * Tidal streams are DRM-protected: no download provider of the app reads them (Soulseek searches by name).
 */
export class TidalService extends MetadataService {
    static readonly display: ProviderDisplay = {
        label: "Tidal",
        acronym: "TD",
        color: "#33ffee",
        colorSubtle: "#0b5a55",
        colorBright: "#7ffff4",
    };
    static readonly summary = "Reads Tidal track links (title, artists, ISRC). Tidal cannot be searched without a key.";
    static readonly defaultSettings: ProviderSettingsSchema = {
        enabled: { label: "Enable", defaultValue: true, kind: "checkbox" },
    };
    static readonly cellComponent = createProviderIdCell("tidal");
    static readonly trackUrl = tidalTrackUrl;
    static readonly openUri = tidalOpenUri;

    constructor(task: DownloadTask, logger: Logger) {
        super("TidalService", task, logger);
    }

    static parseUrl(url: string): ParsedUrl | null {
        return parseTidalUrl(url);
    }

    /** What the track's page says about it. Cached as plain data; a page without a track is an error, not cached. */
    @Cached()
    private async getRecording(id: string): Promise<TidalRecording> {
        this.logger.info(`Reading Tidal track: ${id}`);
        const response = await fetchWithTimeout()(tidalTrackUrl(id), { headers: { Accept: "text/html" } });
        if (response.status === 404) throw new Error(`Tidal has no track ${id}`);
        if (!response.ok) throw new Error(`Tidal answered ${response.status} for track ${id}`);
        const recording = extractTidalRecording(await response.text());
        if (!recording) throw new Error(`Tidal's page of track ${id} does not describe a track`);
        return recording;
    }

    async getTrackMetadata(url: string): Promise<TrackMetadata> {
        const parsed = parseTidalUrl(url);
        if (parsed?.type !== "track" || !parsed.id) throw new Error(`Invalid Tidal track URL: ${url}`);

        this.status.set({ type: StatusType.Processing, message: "Fetching Tidal track", timeTracking: true });
        try {
            const metadata = convertTidalToTrack(await this.getRecording(parsed.id), parsed.id);
            if (!metadata) throw new Error(`Tidal gave no usable data for ${url}`);
            this.status.clear();
            return metadata;
        } catch (error) {
            this.logger.error("Error getting Tidal track:", { error });
            this.status.set({ type: StatusType.Error, message: "Error fetching Tidal track" });
            throw error;
        }
    }

    /** Tidal cannot be searched without an API key: its tracks come from a pasted link or from discovery. */
    async searchTrack(sourceTrackMetadata: TrackMetadata): Promise<SearchTrackResult[]> {
        if (!sourceTrackMetadata.artists?.[0]?.name || !sourceTrackMetadata.trackName) {
            throw new Error("Artist name and track name are required for search");
        }
        this.logger.debug("Tidal has no keyless search: its link comes from Songlink or MusicBrainz");
        return [];
    }
}
