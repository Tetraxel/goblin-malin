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
import { type ProviderAlbum } from "#flows/musicDownloadFlow/musicbrainz/types";
import { createProviderIdCell } from "../../../columns/ProviderIdCell";
import { Cached, NEGATIVE_RESULT_TTL_MS } from "#utils/cache";
import { MetadataService } from "../../../metadataService";
import {
    DEEZER_NO_DATA,
    DEEZER_PERMISSION_CODES,
    DeezerApiError,
    deezerGet,
    followShortLink,
} from "../../apis/deezer-client";
import { convertDeezerToTrack, slimDeezerTrack, type DeezerArtist, type DeezerTrack } from "./convertDeezerToTrack";
import {
    DEAD_SHORT_LINK_MESSAGE,
    deezerOpenUri,
    deezerTrackUrl,
    isDeadDeezerShortLinkId,
    isDeezerShortLinkId,
    parseDeezerUrl,
} from "./deezerUrl";

/** How many search results `searchTrack` asks Deezer for before judging them. */
const SEARCH_CANDIDATES = 10;
/** How many of the matches that pass the gate are kept. */
const MAX_MATCHES = 3;
/** Deezer pages its track lists; it never gives more than 100 at once. */
const PAGE_SIZE = 100;
/** A collection is never read past this many tracks (the import's own cap applies afterwards). */
const MAX_COLLECTION_TRACKS = 2000;

type DeezerList<T> = { data?: T[]; total?: number; next?: string };
type DeezerAlbum = {
    id?: number;
    title?: string;
    link?: string;
    upc?: string;
    record_type?: string;
    release_date?: string;
    nb_tracks?: number;
    contributors?: DeezerArtist[];
    artist?: DeezerArtist;
};
type DeezerPlaylist = { id?: number; title?: string; nb_tracks?: number; creator?: { name?: string } };

/** Every track of a Deezer track list (an album's, a playlist's), page after page. */
async function readTrackList(path: string): Promise<DeezerTrack[]> {
    const tracks: DeezerTrack[] = [];
    for (let index = 0; index < MAX_COLLECTION_TRACKS; index += PAGE_SIZE) {
        const page = await deezerGet<DeezerList<DeezerTrack>>(path, { index, limit: PAGE_SIZE });
        const data = page.data ?? [];
        tracks.push(...data);
        if (data.length < PAGE_SIZE || !page.next) break;
    }
    return tracks;
}

/**
 * Deezer, read through its public API (`api.deezer.com`): no key, no account. A track is found by its ISRC when the
 * seed has one (the same recording, for sure), else by searching artist and title. Albums and playlists are read too.
 * Deezer streams are DRM-protected: no download provider of the app reads them, but Soulseek searches any track by its
 * name, and the ISRC and album Deezer gives help every other step.
 */
export class DeezerService extends MetadataService {
    static readonly display: ProviderDisplay = {
        label: "Deezer",
        acronym: "DZ",
        color: "#a238ff",
        colorSubtle: "#4a1580",
        colorBright: "#c070ff",
    };
    static readonly summary = "Reads Deezer links, albums and playlists, and finds tracks by ISRC or name. No account.";
    static readonly defaultSettings: ProviderSettingsSchema = {
        enabled: { label: "Enable", defaultValue: true, kind: "checkbox" },
    };
    static readonly cellComponent = createProviderIdCell("deezer");
    static readonly trackUrl = deezerTrackUrl;
    static readonly openUri = deezerOpenUri;

    constructor(task: DownloadTask, logger: Logger) {
        super("DeezerService", task, logger);
    }

    static parseUrl(url: string): ParsedUrl | null {
        return parseDeezerUrl(url);
    }

    /**
     * A short link (what Deezer's share button gives, for a track, an album or a playlist) followed to the page it
     * leads to, so the import knows which it is. `null` for any other link. Must not use `this`: it is called unbound.
     */
    static readonly resolveLink = (url: string): Promise<string> | null => {
        const parsed = parseDeezerUrl(url);
        // A dead host is not followed (it answers 404): the track's fetch says why it fails.
        if (!parsed?.id || !isDeezerShortLinkId(parsed.id) || isDeadDeezerShortLinkId(parsed.id)) return null;
        return followShortLink(url).then((target) => {
            const real = parseDeezerUrl(target);
            if (!real?.id || isDeezerShortLinkId(real.id) || real.type === "unknown") return url;
            return `https://www.deezer.com/${real.type}/${real.id}`;
        });
    };

    /** The tracks of an album or a playlist. Not cached: a playlist must show its new tracks on every refresh. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    static async expandCollection(url: string, logger: Logger, _task: Task<any>): Promise<CollectionExpansion> {
        const parsed = parseDeezerUrl(url);
        if ((parsed?.type !== "album" && parsed?.type !== "playlist") || !parsed.id) {
            throw new Error(`Not a Deezer album or playlist URL: ${url}`);
        }
        logger.info(`Reading Deezer ${parsed.type}: ${parsed.id}`);
        try {
            let name: string;
            let ownerName: string | undefined;
            if (parsed.type === "album") {
                const album = await deezerGet<DeezerAlbum>(`/album/${parsed.id}`);
                name = album.title ?? parsed.id;
                ownerName = album.artist?.name;
            } else {
                const playlist = await deezerGet<DeezerPlaylist>(`/playlist/${parsed.id}`);
                name = playlist.title ?? parsed.id;
                ownerName = playlist.creator?.name;
            }
            const tracks = await readTrackList(`/${parsed.type}/${parsed.id}/tracks`);
            const seen = new Set<number>();
            const trackUrls: string[] = [];
            // A track Deezer will not play here (blocked in the user's country) is left out, and counted: a 14-track
            // album that shows 12 says why.
            let unavailable = 0;
            for (const track of tracks) {
                if (track.id === undefined || seen.has(track.id)) continue;
                seen.add(track.id);
                if (track.readable === false) {
                    unavailable++;
                    continue;
                }
                trackUrls.push(deezerTrackUrl(String(track.id)));
            }
            if (unavailable > 0) logger.info(`Deezer: ${unavailable} track(s) not available in your country`);
            return {
                kind: parsed.type,
                name,
                ownerName,
                trackUrls,
                totalCount: trackUrls.length,
                ...(unavailable > 0 ? { unavailable } : {}),
            };
        } catch (error) {
            // Only "not there" and "not for you" mean private or deleted. Any other error (too many requests, Deezer
            // busy) keeps its own message: the list is fine, it is worth trying again later.
            const noAccess =
                error instanceof DeezerApiError &&
                error.code !== undefined &&
                (error.code === DEEZER_NO_DATA || DEEZER_PERMISSION_CODES.includes(error.code));
            if (noAccess) {
                throw new CollectionAccessError(
                    `Deezer would not show this ${parsed.type}: ${parsed.id}`,
                    `Deezer did not let the app read this ${parsed.type}. A playlist must be public to be read without an account; it may also have been deleted.`
                );
            }
            throw error;
        }
    }

    /** Deezer's answer for one track, slimmed. Cached as plain data; the dates are made fresh when mapped. */
    @Cached()
    private async getTrackInfo(id: string): Promise<DeezerTrack> {
        this.logger.info(`Reading Deezer track: ${id}`);
        return slimDeezerTrack(await deezerGet<DeezerTrack>(`/track/${id}`));
    }

    /** The track an ISRC belongs to on Deezer, or null. A "not found" is kept a day only. */
    @Cached({ ttl: (result) => ((result as { found?: boolean }).found ? undefined : NEGATIVE_RESULT_TTL_MS) })
    private async getTrackByIsrc(isrc: string): Promise<{ found: boolean; track?: DeezerTrack }> {
        try {
            const track = await deezerGet<DeezerTrack>(`/track/isrc:${encodeURIComponent(isrc)}`);
            return { found: true, track: slimDeezerTrack(track) };
        } catch (error) {
            if (error instanceof DeezerApiError && error.code === DEEZER_NO_DATA) return { found: false };
            throw error;
        }
    }

    @Cached({ ttl: (result) => (Array.isArray(result) && result.length === 0 ? NEGATIVE_RESULT_TTL_MS : undefined) })
    private async searchEntries(query: string, count: number): Promise<DeezerTrack[]> {
        this.logger.debug(`Searching Deezer: ${query}`);
        // Deezer's advanced syntax (`artist:"…" track:"…"`) misses titles with punctuation: a plain query finds them.
        const page = await deezerGet<DeezerList<DeezerTrack>>("/search", { q: query, limit: count });
        return (page.data ?? []).map(slimDeezerTrack);
    }

    async getTrackMetadata(url: string): Promise<TrackMetadata> {
        let parsed = parseDeezerUrl(url);
        if (parsed?.type !== "track" || !parsed.id) throw new Error(`Invalid Deezer track URL: ${url}`);

        this.status.set({ type: StatusType.Processing, message: "Fetching Deezer track", timeTracking: true });
        try {
            if (isDeadDeezerShortLinkId(parsed.id)) throw new Error(DEAD_SHORT_LINK_MESSAGE);
            if (isDeezerShortLinkId(parsed.id)) {
                const target = await followShortLink(deezerTrackUrl(parsed.id));
                parsed = parseDeezerUrl(target);
                if (parsed?.type === "album" || parsed?.type === "playlist") {
                    // The import follows short links first: only one it could not follow then (offline) gets here.
                    throw new Error(
                        `This Deezer link leads to ${parsed.type === "album" ? "an album" : "a playlist"}: import it again to read its tracks (${url})`
                    );
                }
                if (parsed?.type !== "track" || !parsed.id || isDeezerShortLinkId(parsed.id)) {
                    throw new Error(`This Deezer link does not lead to a track: ${url}`);
                }
            }
            const metadata = convertDeezerToTrack(await this.getTrackInfo(parsed.id));
            if (!metadata) throw new Error(`Deezer gave no usable data for ${url}`);
            this.status.clear();
            return metadata;
        } catch (error) {
            this.logger.error("Error getting Deezer track:", { error });
            this.status.set({ type: StatusType.Error, message: "Error fetching Deezer track" });
            throw error;
        }
    }

    async searchTracks(query: string, limit: number): Promise<TrackMetadata[]> {
        const count = Math.max(1, Math.min(limit, PAGE_SIZE));
        const entries = await this.searchEntries(query.trim(), count);
        return entries
            .map(convertDeezerToTrack)
            .filter((track): track is TrackMetadata => track !== null)
            .slice(0, count);
    }

    async searchTrack(sourceTrackMetadata: TrackMetadata): Promise<SearchTrackResult[]> {
        const artist = sourceTrackMetadata.artists?.[0]?.name;
        const trackName = sourceTrackMetadata.trackName;
        if (!artist || !trackName) throw new Error("Artist name and track name are required for search");

        this.status.set({ type: StatusType.Processing, message: "Searching Deezer", timeTracking: true });
        try {
            // The ISRC names the recording itself: the answer is the track, no guessing.
            const isrc = sourceTrackMetadata.isrc?.trim();
            if (isrc) {
                try {
                    const byIsrc = await this.getTrackByIsrc(isrc);
                    const metadata = byIsrc.track ? convertDeezerToTrack(byIsrc.track) : null;
                    if (metadata) {
                        this.status.clear();
                        return [{ metadata, searchKeys: ["isrc"], query: [{ label: "ISRC", value: isrc }] }];
                    }
                } catch (error) {
                    // A quota error or a timeout on this one call must not cost the track its search by name.
                    this.logger.warn(`Deezer ISRC lookup failed, searching by name instead: ${isrc}`, { error });
                }
            }

            const searchText = `${artist} ${trackName}`;
            const entries = await this.searchEntries(searchText, SEARCH_CANDIDATES);
            const matches = entries
                .map(convertDeezerToTrack)
                .filter((track): track is TrackMetadata => track !== null)
                .map((metadata) => ({ metadata, score: computeConfidenceScore(metadata, sourceTrackMetadata) }))
                .filter(({ score }) => score >= MIN_SEARCH_CONFIDENCE)
                .sort((a, b) => b.score - a.score)
                .slice(0, MAX_MATCHES);
            this.logger.info(`Deezer: ${matches.length} of ${entries.length} result(s) look like the track`);
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
            this.logger.error(`Error searching Deezer for: ${trackName}`, { error });
            this.status.set({ type: StatusType.Error, message: "Error searching Deezer" });
            throw error;
        }
    }

    /** The whole album, with its barcode (UPC): what MusicBrainz recognises a release by best. */
    async getAlbumDetails(
        album: { id: string; url: string },
        options: { withIsrcs?: boolean } = {}
    ): Promise<ProviderAlbum | null> {
        const full = await deezerGet<DeezerAlbum>(`/album/${album.id}`);
        const listed = await readTrackList(`/album/${album.id}/tracks`);
        const isrcs = new Map<number, string>();
        if (options.withIsrcs) {
            // An album's track list carries the ISRC already; only the ones it left out are asked for, one by one (a
            // failure leaves that track without one, as before).
            for (const track of listed) {
                if (track.id === undefined) continue;
                if (track.isrc) {
                    isrcs.set(track.id, track.isrc);
                    continue;
                }
                try {
                    const isrc = (await this.getTrackInfo(String(track.id))).isrc;
                    if (isrc) isrcs.set(track.id, isrc);
                } catch (error) {
                    this.logger.debug(`Deezer: no ISRC for track ${track.id}`, { error });
                }
            }
        }
        const artistOf = (a: DeezerArtist) => ({
            name: a.name ?? "",
            url: a.id !== undefined ? `https://www.deezer.com/artist/${a.id}` : undefined,
        });
        const main = (full.contributors ?? []).filter((c) => !c.role || c.role === "Main");
        return {
            id: String(full.id ?? album.id),
            name: full.title ?? "",
            url: full.link ?? album.url,
            albumType: full.record_type,
            releaseDate: full.release_date,
            barcode: full.upc || undefined,
            trackCount: full.nb_tracks,
            artists: (main.length > 0 ? main : full.artist ? [full.artist] : []).map(artistOf),
            tracks: listed
                .filter((t) => t.id !== undefined)
                .map((t, i) => ({
                    id: String(t.id),
                    name: t.title ?? "",
                    number: t.track_position ?? i + 1,
                    durationMs: t.duration ? t.duration * 1000 : undefined,
                    isrc: isrcs.get(t.id!),
                    artists: t.artist ? [artistOf(t.artist)] : [],
                })),
        };
    }
}
