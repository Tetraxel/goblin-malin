import { type Logger } from "#base/logger/logger";
import { type ParsedUrl, type CollectionExpansion } from "#base/urlParser";
import { type Task } from "#base/task/task";
import { StatusType } from "#base/task/task-status";
import { type ProviderDisplay } from "#base/providerDisplay";
import { type ProviderSettingsSchema } from "#base/providerSettings";
import { type DownloadTask } from "#flows/musicDownloadFlow/utils/downloadTask";
import { computeConfidenceScore, MIN_SEARCH_CONFIDENCE } from "#flows/musicDownloadFlow/utils/confidence";
import { type TrackMetadata, type SearchTrackResult } from "#flows/musicDownloadFlow/types";
import { createProviderIdCell } from "../../../columns/ProviderIdCell";
import { Cached, NEGATIVE_RESULT_TTL_MS } from "#utils/cache";
import { MetadataService } from "../../../metadataService";
import { itunesGet } from "../../apis/itunes-client";
import {
    convertAppleMusicToTrack,
    slimITunesResult,
    type ITunesAnswer,
    type ITunesResult,
} from "./convertAppleMusicToTrack";
import { appleMusicStorefront, appleMusicTrackUrl, DEFAULT_STOREFRONT, parseAppleMusicUrl } from "./appleMusicUrl";

/** How many search results `searchTrack` asks Apple for before judging them. */
const SEARCH_CANDIDATES = 10;
/** How many of the matches that pass the gate are kept. */
const MAX_MATCHES = 3;
/** The iTunes API never gives more than 200 results at once. */
const MAX_RESULTS = 200;

/**
 * Apple Music, read through Apple's public iTunes Search / Lookup API (`itunes.apple.com`): no key, no account, no
 * Apple Music subscription. It finds a track by artist and title (the API has no ISRC lookup), and reads albums.
 * Songlink and MusicBrainz call the same platform `appleMusic` or `itunes`: both are read here.
 * Apple Music streams are DRM-protected: no download provider of the app reads them (Soulseek searches by name).
 */
export class AppleMusicService extends MetadataService {
    static readonly display: ProviderDisplay = {
        label: "Apple Music",
        acronym: "AM",
        color: "#fa2d48",
        colorSubtle: "#6e1020",
        colorBright: "#ff5a6e",
    };
    static readonly summary = "Reads Apple Music links and albums, and searches Apple's catalogue. No account.";
    static readonly defaultSettings: ProviderSettingsSchema = {
        enabled: { label: "Enable", defaultValue: true, kind: "checkbox" },
    };
    static readonly cellComponent = createProviderIdCell("appleMusic");
    static readonly platformAliases = ["itunes"] as const;
    static readonly trackUrl = appleMusicTrackUrl;

    /**
     * Set while `searchTrack` / `getTrackMetadata` run (they own the track's status): a call that has to wait for
     * Apple's turn says so on the track instead of looking stuck. The agent's `searchTracks` leaves it unset.
     */
    private onAppleWait?: (waitMs: number) => void;

    constructor(task: DownloadTask, logger: Logger) {
        super("AppleMusicService", task, logger);
    }

    /** Runs `fn` with the track's status saying when an Apple call waits for its turn (the caller sets it after). */
    private async showingWaits<T>(fn: () => Promise<T>): Promise<T> {
        this.onAppleWait = (waitMs) =>
            this.status.set({
                type: StatusType.Processing,
                message: `Waiting for Apple Music (${Math.ceil(waitMs / 1000)} s): it allows about 20 calls a minute`,
                timeTracking: true,
            });
        try {
            return await fn();
        } finally {
            this.onAppleWait = undefined;
        }
    }

    static parseUrl(url: string): ParsedUrl | null {
        return parseAppleMusicUrl(url);
    }

    /** The tracks of an album, in the store its link points into. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    static async expandCollection(url: string, logger: Logger, _task: Task<any>): Promise<CollectionExpansion> {
        const parsed = parseAppleMusicUrl(url);
        if (parsed?.type !== "album" || !parsed.id) throw new Error(`Not an Apple Music album URL: ${url}`);
        const country = appleMusicStorefront(url);
        logger.info(`Reading Apple Music album: ${parsed.id} (${country})`);
        const answer = await itunesGet<ITunesAnswer>("lookup", {
            id: parsed.id,
            entity: "song",
            limit: MAX_RESULTS,
            country,
        });
        const results = answer.results ?? [];
        const album = results.find((r) => r.wrapperType === "collection");
        if (!album) throw new Error(`Apple Music has no album ${parsed.id} in the "${country}" store`);
        const songs = results
            .filter((r) => r.wrapperType === "track" && r.trackId !== undefined)
            .sort((a, b) => (a.discNumber ?? 1) - (b.discNumber ?? 1) || (a.trackNumber ?? 0) - (b.trackNumber ?? 0));
        const trackUrls = [...new Set(songs.map((s) => trackPageIn(country, s.trackId!)))];
        return {
            kind: "album",
            name: album.collectionName ?? parsed.id,
            ownerName: album.artistName,
            trackUrls,
            totalCount: trackUrls.length,
        };
    }

    /** The song of an id in a store, slimmed, or null when the store does not have it. */
    @Cached({ ttl: (result) => ((result as { found?: boolean }).found ? undefined : NEGATIVE_RESULT_TTL_MS) })
    private async lookupSong(id: string, country: string): Promise<{ found: boolean; song?: ITunesResult }> {
        this.logger.info(`Reading Apple Music track: ${id} (${country})`);
        const answer = await itunesGet<ITunesAnswer>(
            "lookup",
            { id, entity: "song", country },
            { onWait: this.onAppleWait }
        );
        const song = (answer.results ?? []).find((r) => r.wrapperType === "track" && String(r.trackId) === id);
        return song ? { found: true, song: slimITunesResult(song) } : { found: false };
    }

    @Cached({ ttl: (result) => (Array.isArray(result) && result.length === 0 ? NEGATIVE_RESULT_TTL_MS : undefined) })
    private async searchEntries(query: string, count: number): Promise<ITunesResult[]> {
        this.logger.debug(`Searching Apple Music: ${query}`);
        const answer = await itunesGet<ITunesAnswer>(
            "search",
            { term: query, media: "music", entity: "song", limit: count, country: DEFAULT_STOREFRONT },
            { onWait: this.onAppleWait }
        );
        return (answer.results ?? []).map(slimITunesResult);
    }

    async getTrackMetadata(url: string): Promise<TrackMetadata> {
        const parsed = parseAppleMusicUrl(url);
        if (parsed?.type !== "track" || !parsed.id) throw new Error(`Invalid Apple Music track URL: ${url}`);
        const country = appleMusicStorefront(url);

        this.status.set({ type: StatusType.Processing, message: "Fetching Apple Music track", timeTracking: true });
        try {
            const id = parsed.id;
            const song = await this.showingWaits(async () => {
                const inStore = await this.lookupSong(id, country);
                // A link from another store may name a song the US store also has (most do).
                if (inStore.song || country === DEFAULT_STOREFRONT) return inStore.song;
                return (await this.lookupSong(id, DEFAULT_STOREFRONT)).song;
            });
            const metadata = song ? convertAppleMusicToTrack(song) : null;
            if (!metadata) throw new Error(`Apple Music has no track ${parsed.id} (store "${country}")`);
            this.status.clear();
            return metadata;
        } catch (error) {
            this.logger.error("Error getting Apple Music track:", { error });
            this.status.set({ type: StatusType.Error, message: "Error fetching Apple Music track" });
            throw error;
        }
    }

    async searchTracks(query: string, limit: number): Promise<TrackMetadata[]> {
        const count = Math.max(1, Math.min(limit, MAX_RESULTS));
        const entries = await this.searchEntries(query.trim(), count);
        return entries
            .map(convertAppleMusicToTrack)
            .filter((track): track is TrackMetadata => track !== null)
            .slice(0, count);
    }

    async searchTrack(sourceTrackMetadata: TrackMetadata): Promise<SearchTrackResult[]> {
        const artist = sourceTrackMetadata.artists?.[0]?.name;
        const trackName = sourceTrackMetadata.trackName;
        if (!artist || !trackName) throw new Error("Artist name and track name are required for search");

        this.status.set({ type: StatusType.Processing, message: "Searching Apple Music", timeTracking: true });
        try {
            const searchText = `${artist} ${trackName}`;
            const entries = await this.showingWaits(() => this.searchEntries(searchText, SEARCH_CANDIDATES));
            const matches = entries
                .map(convertAppleMusicToTrack)
                .filter((track): track is TrackMetadata => track !== null)
                .map((metadata) => ({ metadata, score: computeConfidenceScore(metadata, sourceTrackMetadata) }))
                .filter(({ score }) => score >= MIN_SEARCH_CONFIDENCE)
                .sort((a, b) => b.score - a.score)
                .slice(0, MAX_MATCHES);
            this.logger.info(`Apple Music: ${matches.length} of ${entries.length} result(s) look like the track`);
            this.status.clear();
            const query = [
                { label: "Search", value: searchText },
                {
                    label: "Kept",
                    value: `${matches.length} of ${entries.length} result(s) scoring at least ${MIN_SEARCH_CONFIDENCE}%`,
                },
            ];
            return matches.map(({ metadata }) => ({ metadata, searchKeys: ["trackName+artistName"], query }));
        } catch (error) {
            this.logger.error(`Error searching Apple Music for: ${trackName}`, { error });
            this.status.set({ type: StatusType.Error, message: "Error searching Apple Music" });
            throw error;
        }
    }
}

/** A track's page in a store: an album link of that store keeps its tracks in it. */
function trackPageIn(country: string, trackId: number): string {
    return country === DEFAULT_STOREFRONT
        ? appleMusicTrackUrl(String(trackId))
        : `https://music.apple.com/${country}/song/${trackId}`;
}
