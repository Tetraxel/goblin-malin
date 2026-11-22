import { type Logger } from "#base/logger/logger";
import { type ParsedUrl, type CollectionExpansion } from "#base/urlParser";
import { type Task } from "#base/task/task";
import { CollectionAccessError } from "#base/collectionAccessError";
import { StatusType } from "#base/task/task-status";
import { type ProviderDisplay } from "#base/providerDisplay";
import { type ProviderSettingsSchema } from "#base/providerSettings";
import { type DownloadTask } from "#flows/musicDownloadFlow/utils/downloadTask";
import { computeConfidenceScore, MIN_SEARCH_CONFIDENCE } from "#flows/musicDownloadFlow/utils/confidence";
import { type TrackMetadata, type SearchTrackResult } from "#flows/musicDownloadFlow/types";
import { Cached, NEGATIVE_RESULT_TTL_MS } from "#utils/cache";
import { MetadataService } from "../../../metadataService";
import { isYtDlpEnabled, readYtDlpInfo, YtDlpDisabledError } from "../../apis/ytdlp-client";
import { SoundCloudCell } from "./SoundCloudCell";
import { convertSoundCloudToTrack, slimSoundCloudInfo, type SoundCloudInfo } from "./convertSoundCloudToTrack";
import { followLink } from "#utils/followLink";
import {
    isSoundCloudShortLinkId,
    parseSoundCloudUrl,
    soundcloudPlaylistUrl,
    soundcloudTrackUrl,
} from "./soundcloudUrl";

/** yt-dlp is a process that talks to SoundCloud: a hung one must not hold the whole metadata stage. */
const YTDLP_TIMEOUT_MS = 60_000;
/** How many search results `searchTrack` asks SoundCloud for before judging them. */
const SEARCH_CANDIDATES = 8;
/** How many of the matches that pass the gate are kept. Several uploads of a song are common on SoundCloud. */
const MAX_MATCHES = 3;
/**
 * SoundCloud search is open to anyone's upload: bootlegs, slowed edits and reposts rank next to the real track. Unlike
 * the other services (whose first hit is trusted), a result must look like the track (see `computeConfidenceScore`)
 * to be proposed. Same bar as every other service's search (`MIN_SEARCH_CONFIDENCE`).
 */
const MIN_CONFIDENCE = MIN_SEARCH_CONFIDENCE;

type FlatSearch = { entries?: SoundCloudInfo[] };
/** yt-dlp's flat listing of a set: its own title and owner, then one entry per track (`url` is the track's page). */
type SoundCloudSetInfo = SoundCloudInfo & { entries?: { url?: string }[] };

/** A set of a few hundred tracks takes longer to list than one track page to read. */
const PLAYLIST_TIMEOUT_MS = 120_000;

/**
 * SoundCloud, read through yt-dlp's own SoundCloud extractor: no API key (SoundCloud has closed new API
 * registrations) and no setup beyond the yt-dlp binary the app already downloads. The same binary downloads the audio
 * (`YtDlpService` lists `soundcloud` among the metadata it can download), so a track found here becomes a download
 * source with no other code.
 */
export class SoundCloudService extends MetadataService {
    static readonly display: ProviderDisplay = {
        label: "SoundCloud",
        acronym: "SC",
        color: "#ff5510",
        colorSubtle: "#7a2500",
        colorBright: "#ff5500",
    };
    static readonly summary = "Reads SoundCloud tracks and sets, and searches SoundCloud (through yt-dlp).";
    static readonly defaultSettings: ProviderSettingsSchema = {
        enabled: { label: "Enable", defaultValue: true, kind: "checkbox" },
    };
    static readonly cellComponent = SoundCloudCell;
    static readonly trackUrl = soundcloudTrackUrl;

    /**
     * A short link (`on.soundcloud.com/<code>`, what SoundCloud's share button gives, for a track or a set) followed to
     * the page it leads to, so the import knows whether it is a track or a playlist. `null` for any other link. Must
     * not use `this`: it is called unbound.
     */
    static readonly resolveLink = (url: string): Promise<string> | null => {
        const parsed = parseSoundCloudUrl(url);
        if (!parsed?.id || !isSoundCloudShortLinkId(parsed.id)) return null;
        return followLink(url).then((target) => {
            const real = parseSoundCloudUrl(target);
            if (!real?.id || isSoundCloudShortLinkId(real.id)) return url;
            return real.type === "playlist" ? soundcloudPlaylistUrl(real.id) : soundcloudTrackUrl(real.id);
        });
    };

    constructor(task: DownloadTask, logger: Logger) {
        super("SoundCloudService", task, logger);
    }

    static parseUrl(url: string): ParsedUrl | null {
        return parseSoundCloudUrl(url);
    }

    /**
     * Lists the tracks of a playlist or album (a SoundCloud "set") through yt-dlp's flat listing: one request, no
     * track page is read yet (each track is then imported like a pasted link). Deliberately NOT cached: a live playlist
     * must see its new tracks on every refresh.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    static async expandCollection(url: string, logger: Logger, _task: Task<any>): Promise<CollectionExpansion> {
        const parsed = parseSoundCloudUrl(url);
        if (parsed?.type !== "playlist" || !parsed.id) throw new Error(`Not a SoundCloud playlist URL: ${url}`);

        logger.info(`Reading SoundCloud playlist: ${parsed.id}`);
        let listing: SoundCloudSetInfo;
        try {
            listing = await readYtDlpInfo<SoundCloudSetInfo>(soundcloudPlaylistUrl(parsed.id), {
                timeoutMs: PLAYLIST_TIMEOUT_MS,
                timeoutMessage: "SoundCloud took too long to answer",
                site: "SoundCloud",
            });
        } catch (error) {
            if (error instanceof YtDlpDisabledError) {
                throw new CollectionAccessError(
                    error.message,
                    "SoundCloud is read through yt-dlp, which is switched off. Turn it on in Settings → Download to import this playlist."
                );
            }
            // A private set (or one that was deleted) answers 403 / 404 to a reader with no sign-in.
            if (/\b(403|404)\b|private|not found|does not exist/i.test(error instanceof Error ? error.message : "")) {
                throw new CollectionAccessError(
                    `SoundCloud would not show this playlist: ${parsed.id}`,
                    "SoundCloud did not let the app read this playlist. It may be private (use its “secret link”, the one ending in /s-…) or it may have been deleted."
                );
            }
            throw error;
        }

        // Each track is the page SoundCloud lists it under, written the way a pasted link is read (one track, one id);
        // an entry that is not a track page is not importable and is left out.
        const seen = new Set<string>();
        const trackUrls: string[] = [];
        for (const entry of listing.entries ?? []) {
            const track = entry.url ? parseSoundCloudUrl(entry.url) : null;
            if (track?.type !== "track" || !track.id || seen.has(track.id)) continue;
            seen.add(track.id);
            trackUrls.push(soundcloudTrackUrl(track.id));
        }
        const skipped = (listing.entries?.length ?? 0) - trackUrls.length;
        if (skipped > 0)
            logger.warn(`SoundCloud: ${skipped} entr${skipped === 1 ? "y" : "ies"} of the playlist skipped`);

        return {
            kind: listing.album_type === "album" ? "album" : "playlist",
            name: (listing.title ?? "").trim() || parsed.id,
            ownerName: listing.uploader || undefined,
            trackUrls,
            totalCount: trackUrls.length,
        };
    }

    /** yt-dlp's JSON for one track page. Cached as the raw JSON: it is plain data, and dates are made fresh when mapped. */
    @Cached()
    private async getTrackInfo(url: string): Promise<SoundCloudInfo> {
        this.logger.info(`Reading SoundCloud track: ${url}`);
        const info = await readYtDlpInfo<SoundCloudInfo>(url, {
            timeoutMs: YTDLP_TIMEOUT_MS,
            timeoutMessage: "SoundCloud took too long to answer",
            site: "SoundCloud",
        });
        // A short link can lead to a playlist or a profile: this service only reads tracks.
        if (info._type === "playlist") throw new Error(`Not a SoundCloud track: ${url}`);
        return slimSoundCloudInfo(info);
    }

    /**
     * The entries of a SoundCloud search: yt-dlp's flat listing already carries title, uploader, duration and page.
     * `signal` kills the yt-dlp process when the search is skipped or stopped (it is not part of the cache key).
     */
    @Cached({ ttl: (result) => (Array.isArray(result) && result.length === 0 ? NEGATIVE_RESULT_TTL_MS : undefined) })
    private async searchEntries(query: string, count: number, signal?: AbortSignal): Promise<SoundCloudInfo[]> {
        this.logger.debug(`Searching SoundCloud: ${query}`);
        const listing = await readYtDlpInfo<FlatSearch>(`scsearch${count}:${query}`, {
            timeoutMs: YTDLP_TIMEOUT_MS,
            timeoutMessage: "SoundCloud took too long to answer",
            site: "SoundCloud",
            signal,
        });
        return (listing.entries ?? []).map(slimSoundCloudInfo);
    }

    async getTrackMetadata(url: string): Promise<TrackMetadata> {
        const parsed = parseSoundCloudUrl(url);
        if (parsed?.type !== "track" || !parsed.id) throw new Error(`Invalid SoundCloud track URL: ${url}`);
        // Reading the page would download yt-dlp for a user who switched it off (a Soulseek-only setup). A link found
        // by discovery stays a bare link; a pasted one fails with the reason.
        if (!isYtDlpEnabled()) throw new YtDlpDisabledError("SoundCloud");

        this.status.set({
            type: StatusType.Processing,
            message: "Fetching SoundCloud track",
            timeTracking: true,
            progress: 0,
        });
        try {
            const info = await this.getTrackInfo(soundcloudTrackUrl(parsed.id));
            // The track keeps the id the link was read as, even when SoundCloud's own page address differs (a short
            // link, a renamed permalink): the link the user pasted is stored under that id and must find its row again.
            const metadata = convertSoundCloudToTrack(info, parsed.id);
            if (!metadata) throw new Error(`SoundCloud gave no usable data for ${url}`);
            this.status.clear();
            return metadata;
        } catch (error) {
            this.logger.error("Error getting SoundCloud track:", { error });
            this.status.set({ type: StatusType.Error, message: "Error fetching SoundCloud track" });
            throw error;
        }
    }

    async searchTracks(query: string, limit: number): Promise<TrackMetadata[]> {
        const count = Math.max(1, limit);
        const entries = await this.searchEntries(query.trim(), count);
        return entries
            .map((entry) => convertSoundCloudToTrack(entry))
            .filter((track): track is TrackMetadata => track !== null)
            .slice(0, count);
    }

    async searchTrack(
        sourceTrackMetadata: TrackMetadata,
        options?: { signal?: AbortSignal }
    ): Promise<SearchTrackResult[]> {
        const artist = sourceTrackMetadata.artists?.[0]?.name;
        const trackName = sourceTrackMetadata.trackName;
        if (!artist || !trackName) {
            throw new Error("Artist name and track name are required for search");
        }
        // The same yt-dlp downloads these tracks. With it switched off, reading SoundCloud would only start the
        // binary download for a user who chose not to use yt-dlp, and propose tracks nothing could download.
        if (!isYtDlpEnabled()) {
            this.logger.debug("yt-dlp is switched off: not searching SoundCloud");
            return [];
        }

        this.status.set({
            type: StatusType.Processing,
            message: "Searching SoundCloud",
            timeTracking: true,
            progress: 0,
        });
        try {
            const searchText = `${artist} ${trackName}`;
            const entries = await this.searchEntries(searchText, SEARCH_CANDIDATES, options?.signal);
            const matches = entries
                .map((entry) => convertSoundCloudToTrack(entry))
                .filter((track): track is TrackMetadata => track !== null)
                .map((metadata) => ({ metadata, score: computeConfidenceScore(metadata, sourceTrackMetadata) }))
                .filter(({ score }) => score >= MIN_CONFIDENCE)
                .sort((a, b) => b.score - a.score)
                .slice(0, MAX_MATCHES);

            this.logger.info(`SoundCloud: ${matches.length} of ${entries.length} result(s) look like the track`);
            this.status.clear();
            // What SoundCloud was asked, and how many of its answers were kept: the same for every result.
            const query = [
                { label: "Search", value: `scsearch${SEARCH_CANDIDATES}:${searchText}` },
                {
                    label: "Kept",
                    value: `${matches.length} of ${entries.length} result(s) scoring at least ${MIN_CONFIDENCE}%`,
                },
            ];
            return matches.map(({ metadata }) => ({ metadata, searchKeys: ["trackName+artistName"], query }));
        } catch (error) {
            // Skipped or stopped: nobody waits for this search, and it did not fail.
            if (options?.signal?.aborted) {
                this.status.clear();
                throw error;
            }
            this.logger.error(`Error searching SoundCloud for: ${trackName}`, { error });
            this.status.set({ type: StatusType.Error, message: "Error searching SoundCloud" });
            throw error;
        }
    }
}
