import type YTMusic from "ytmusic-api";
import type { SongFull, VideoFull, ArtistFull, AlbumFull } from "ytmusic-api";
import { type Logger } from "#base/logger/logger";
import { type ParsedUrl, type CollectionExpansion } from "#base/urlParser";
import { type Task } from "#base/task/task";
import { StatusType } from "#base/task/task-status";
import { type ProviderDisplay } from "#base/providerDisplay";
import { type ProviderSettingsSchema } from "#base/providerSettings";
import { type DownloadTask } from "#flows/musicDownloadFlow/utils/downloadTask";
import {
    type StandardArtist,
    type StandardTrack,
    type TrackMetadata,
    type TrackUri,
    type SearchTrackResult,
} from "#flows/musicDownloadFlow/types";
import { computeConfidenceScore, MIN_SEARCH_CONFIDENCE } from "#flows/musicDownloadFlow/utils/confidence";
import { splitArtistAndTitle } from "#flows/musicDownloadFlow/utils/splitArtistAndTitle";
import { Cached } from "#utils/cache";
import { YoutubeCell } from "./YoutubeCell";
import { MetadataService } from "../../../metadataService";

/** How many of YouTube Music's top hits `searchTrack` scores before choosing one. */
const SEARCH_CANDIDATES = 8;

/** At most this many video uploads are proposed for one track (re-uploads of the same remix are common). */
const MAX_VIDEOS = 2;
/**
 * An upload is anyone's: the original mix of a song scores 50% against its remix, and a wrong version must not become
 * the download. A video needs more than a catalogue song does (`MIN_SEARCH_CONFIDENCE`) to be proposed.
 */
const MIN_VIDEO_CONFIDENCE = MIN_SEARCH_CONFIDENCE + 10;

type SearchHit = Awaited<ReturnType<YTMusic["searchSongs"]>>[number];
type VideoHit = Awaited<ReturnType<YTMusic["searchVideos"]>>[number];

/** What a video title carries besides the song: "(Official Video)", "[Lyrics]", "(HD)"… */
const VIDEO_TITLE_NOISE =
    /\s*[([{]\s*(?:official\s+)?(?:music\s+)?(?:video|audio|lyrics?(?:\s+video)?|visuali[sz]er|hd|hq|4k|mv|clip)\s*[)\]}]/gi;

const cleanVideoTitle = (title: string): string =>
    title.replace(VIDEO_TITLE_NOISE, "").replace(/\s+/g, " ").trim() || title;

/** The channel (or artist) YouTube Music names for a song or video, as the app's artist list. */
function channelArtists(artist: { artistId: string | null; name: string } | null | undefined): StandardArtist[] {
    if (!artist) return [];
    return [
        {
            id: artist.artistId || "",
            type: "artist" as const,
            name: artist.name,
            url: artist.artistId ? `https://music.youtube.com/browse/${artist.artistId}` : "",
            uri: `youtube:artist:${artist.artistId || artist.name}`,
        },
    ];
}

export class YoutubeService extends MetadataService {
    static readonly display: ProviderDisplay = {
        label: "YouTube",
        acronym: "YT",
        color: "#ff0033",
        colorSubtle: "#7a1500",
        colorBright: "#ff4040",
    };
    static readonly defaultSettings: ProviderSettingsSchema = {
        enabled: { label: "Enable", defaultValue: true, kind: "checkbox" },
    };
    static readonly cellComponent = YoutubeCell;
    // YouTube Music links are plain YouTube videos and share this service's URIs.
    static readonly platformAliases = ["youtubeMusic"] as const;
    static readonly trackUrl = (id: string): string => `https://www.youtube.com/watch?v=${id}`;
    // What yt-dlp's FLAC of a YouTube video was transcoded from (the stream it keeps is Opus).
    static readonly upstreamCodec = "Opus";

    private static client: YTMusic;

    constructor(task: DownloadTask, logger: Logger) {
        super("YoutubeService", task, logger);
    }

    private async getClient(): Promise<YTMusic> {
        return this.runExclusive("init", async () => {
            if (!YoutubeService.client) {
                // Loaded on first use: ~90 ms of start-up the app does not need until a YouTube link is read.
                const { default: YTMusicClient } = await import("ytmusic-api");
                const ytMusic = new YTMusicClient();
                await ytMusic.initialize();
                YoutubeService.client = ytMusic;
            }
            return YoutubeService.client;
        });
    }

    /**
     * Get full information about a specific song
     * @param videoId - YouTube music/video ID
     * @returns Full song data including formats
     */
    @Cached()
    public async getSong(videoId: string): Promise<SongFull> {
        try {
            this.logger.info(`Getting song data for video ID: "${videoId}"…`);
            this.status.set({
                type: StatusType.Processing,
                message: "Fetching song data",
                timeTracking: true,
                progress: 0,
            });

            const client = await this.getClient();
            const song = await client.getSong(videoId);

            this.logger.info("Song data retrieved", { videoId: song.videoId, name: song.name });
            this.status.update({ progress: 100 });
            this.status.clear();

            return song;
        } catch (error) {
            this.logger.error("Error getting song:", { error });
            this.status.set({
                type: StatusType.Error,
                message: "Error fetching song data",
            });
            throw new Error(`Failed to get song: ${error}`);
        }
    }

    /**
     * Get full information about a specific video
     * @param videoId - YouTube video ID
     * @returns Full video data
     */
    @Cached()
    public async getVideo(videoId: string): Promise<VideoFull> {
        try {
            this.logger.info(`Getting video data for video ID: "${videoId}"…`);
            this.status.set({
                type: StatusType.Processing,
                message: "Fetching video data",
                timeTracking: true,
                progress: 0,
            });

            const client = await this.getClient();
            const video = await client.getVideo(videoId);

            this.logger.info("Video data retrieved", { videoId: video.videoId, name: video.name });
            this.status.update({ progress: 100 });
            this.status.clear();

            return video;
        } catch (error) {
            this.logger.error("Error getting video:", { error });
            this.status.set({
                type: StatusType.Error,
                message: "Error fetching video data",
            });
            throw new Error(`Failed to get video: ${error}`);
        }
    }

    /**
     * Get full information about an artist
     * @param artistId - YouTube Music artist ID
     * @returns Full artist data including top songs, albums, etc.
     */
    @Cached()
    public async getArtist(artistId: string): Promise<ArtistFull> {
        try {
            this.logger.info(`Getting artist data for artist ID: "${artistId}"…`);
            this.status.set({
                type: StatusType.Processing,
                message: "Fetching artist data",
                timeTracking: true,
                progress: 0,
            });

            const client = await this.getClient();
            const artist = await client.getArtist(artistId);

            this.logger.info("Artist data retrieved", { artistId: artist.artistId, name: artist.name });
            this.status.update({ progress: 100 });
            this.status.clear();

            return artist;
        } catch (error) {
            this.logger.error("Error getting artist:", { error });
            this.status.set({
                type: StatusType.Error,
                message: "Error fetching artist data",
            });
            throw new Error(`Failed to get artist: ${error}`);
        }
    }

    /**
     * Get full information about an album
     * @param albumId - YouTube Music album ID
     * @returns Full album data including all songs
     */
    @Cached()
    public async getAlbum(albumId: string): Promise<AlbumFull> {
        try {
            this.logger.info(`Getting album data for album ID: "${albumId}"…`);
            this.status.set({
                type: StatusType.Processing,
                message: "Fetching album data",
                timeTracking: true,
                progress: 0,
            });

            const client = await this.getClient();
            const album = await client.getAlbum(albumId);

            this.logger.info("Album data retrieved", { albumId: album.albumId, name: album.name });
            this.status.update({ progress: 100 });
            this.status.clear();

            return album;
        } catch (error) {
            this.logger.error("Error getting album:", { error });
            this.status.set({
                type: StatusType.Error,
                message: "Error fetching album data",
            });
            throw new Error(`Failed to get album: ${error}`);
        }
    }

    static parseUrl(url: string): ParsedUrl | null {
        let parsed: URL;
        try {
            parsed = new URL(url);
        } catch {
            return null;
        }
        const host = parsed.hostname.replace(/^www\./, "");

        if (host === "music.youtube.com") {
            if (parsed.pathname === "/playlist") {
                const id = parsed.searchParams.get("list") ?? undefined;
                return id ? { platform: "youtube", type: "playlist", id } : null;
            }
            if (!parsed.pathname.startsWith("/watch")) return null;
            return { platform: "youtube", type: "track", id: parsed.searchParams.get("v") ?? undefined };
        }

        if (host === "youtube.com" || host.endsWith(".youtube.com")) {
            if (parsed.pathname === "/playlist") {
                const id = parsed.searchParams.get("list") ?? undefined;
                return id ? { platform: "youtube", type: "playlist", id } : null;
            }
            if (parsed.pathname !== "/watch") return null;
            return { platform: "youtube", type: "track", id: parsed.searchParams.get("v") ?? undefined };
        }

        if (host === "youtu.be") {
            const id = parsed.pathname.slice(1) || undefined;
            return { platform: "youtube", type: "track", id };
        }

        return null;
    }

    /**
     * Resolve a playlist URL to its track listing. Deliberately NOT wrapped in
     * @Cached() — a live-refreshing playlist must see fresh results on every
     * refetch. `getPlaylistVideos` handles its own pagination internally (no
     * limit/offset params on the client). YouTube Music albums aren't recognized
     * by parseUrl (browse-id URLs, not `?list=` — ambiguous to parse reliably), so
     * this only ever runs for playlists.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    static async expandCollection(url: string, logger: Logger, task: Task<any>): Promise<CollectionExpansion> {
        const parsed = YoutubeService.parseUrl(url);
        if (!parsed?.id || parsed.type !== "playlist") {
            throw new Error(`Not a YouTube playlist URL: ${url}`);
        }

        const instance = new YoutubeService(task as unknown as DownloadTask, logger);
        const client = await instance.getClient();

        const [playlist, videos] = await Promise.all([
            client.getPlaylist(parsed.id),
            client.getPlaylistVideos(parsed.id),
        ]);

        return {
            kind: "playlist",
            name: playlist.name,
            ownerName: playlist.artist?.name ?? undefined,
            trackUrls: videos.map((v) => `https://music.youtube.com/watch?v=${v.videoId}`),
            totalCount: playlist.videoCount,
        };
    }

    @Cached()
    async getTrackMetadata(url: string): Promise<TrackMetadata> {
        const videoId = YoutubeService.parseUrl(url)?.id;
        if (!videoId) {
            throw new Error(`Invalid YouTube track URL: ${url}`);
        }

        const song = await this.getSong(videoId);
        if (!song) {
            throw new Error(`Could not fetch YouTube song: ${videoId}`);
        }

        // Convert YouTube song to StandardTrack format
        const standardTrack: StandardTrack = {
            id: song.videoId,
            isrc: undefined, // YouTube API typically doesn't provide ISRC
            trackName: song.name,
            duration: song.duration ? song.duration * 1000 : undefined, // Convert to ms
            trackNumber: undefined,
            url,
            uri: `https://www.youtube.com/watch?v=${song.videoId}`,
            album: undefined, // YouTube API doesn't provide album info in SongFull
            artists: song.artist
                ? [
                      {
                          id: song.artist.artistId || "",
                          type: "artist" as const,
                          name: song.artist.name,
                          url: song.artist.artistId ? `https://music.youtube.com/browse/${song.artist.artistId}` : "",
                          uri: `youtube:artist:${song.artist.artistId || song.artist.name}`,
                      },
                  ]
                : [],
        };

        const metadata: TrackMetadata = {
            ...standardTrack,
            platform: "youtube",
            apiProvider: "youtube",
            uri: `YOUTUBE::TRACK::${song.videoId}` as TrackUri<"youtube">,

            fetchedAt: new Date(),
            type: "track",
        };

        return metadata;
    }

    async searchTracks(query: string, limit: number): Promise<TrackMetadata[]> {
        const client = await this.getClient();
        const count = Math.max(1, limit);
        // Songs first, then some videos (marked `isUpload`): a remix or an unreleased track is often only a video. A
        // video search that fails must not lose the songs.
        const [songs, videos] = await Promise.all([
            client.searchSongs(query),
            client.searchVideos(query).catch((error) => {
                this.logger.warn("YouTube Music video search failed", { error });
                return [] as VideoHit[];
            }),
        ]);
        const found = songs.slice(0, count).map((song) => this.searchHitToTrack(song));
        const seen = new Set(found.map((track) => track.id));
        const uploads = videos
            .filter((video) => !seen.has(video.videoId))
            .slice(0, Math.max(1, Math.floor(count / 2)))
            .map((video) => this.videoHitToTrack(video));
        return [...found, ...uploads];
    }

    /** One entry of a YouTube Music search, as the app's metadata (what a search lists: no album artists, no year). */
    private searchHitToTrack(song: SearchHit): TrackMetadata {
        const url = `https://www.youtube.com/watch?v=${song.videoId}`;
        return {
            id: song.videoId,
            isrc: undefined,
            trackName: song.name,
            duration: song.duration ? song.duration * 1000 : undefined,
            trackNumber: undefined,
            url,
            uri: `YOUTUBE::TRACK::${song.videoId}` as TrackUri<"youtube">,
            album: song.album
                ? {
                      id: song.album.albumId,
                      albumName: song.album.name,
                      url: `https://music.youtube.com/browse/${song.album.albumId}`,
                      uri: `youtube:album:${song.album.albumId}`,
                  }
                : undefined,
            artists: song.artist
                ? [
                      {
                          id: song.artist.artistId || "",
                          type: "artist" as const,
                          name: song.artist.name,
                          url: song.artist.artistId ? `https://music.youtube.com/browse/${song.artist.artistId}` : "",
                          uri: `youtube:artist:${song.artist.artistId || song.artist.name}`,
                      },
                  ]
                : [],
            platform: "youtube",
            apiProvider: "youtube",
            fetchedAt: new Date(),
            type: "track",
        } as TrackMetadata;
    }

    /**
     * The song, among the top hits, that looks most like `source` (at least `MIN_SEARCH_CONFIDENCE`), or undefined. The
     * first hit is only the one YouTube ranks first for the words: a search for "Song (Some Remix) Artist" can lead
     * with another song that shares only the remixer's name.
     */
    private async bestSong(
        hits: SearchHit[],
        source: TrackMetadata,
        query: string
    ): Promise<SearchTrackResult | undefined> {
        const candidates = hits
            .slice(0, SEARCH_CANDIDATES)
            .map((hit, index) => ({
                hit,
                rank: index + 1,
                score: computeConfidenceScore(this.searchHitToTrack(hit), source),
            }))
            .sort((a, b) => b.score - a.score);
        const best = candidates[0];
        if (!best) return undefined;
        if (best.score < MIN_SEARCH_CONFIDENCE) {
            this.logger.info(
                `YouTube Music: none of the top ${candidates.length} songs looks like the track (best ${best.score}%: "${best.hit.name}")`
            );
            return undefined;
        }

        // The chosen hit's full metadata
        const full = await this.getSong(best.hit.videoId);
        const metadata: TrackMetadata = {
            id: full.videoId,
            isrc: undefined,
            trackName: full.name,
            duration: full.duration ? full.duration * 1000 : undefined,
            trackNumber: undefined,
            url: `https://www.youtube.com/watch?v=${full.videoId}`,
            album: undefined,
            artists: channelArtists(full.artist),
            platform: "youtube",
            apiProvider: "youtube",
            uri: `YOUTUBE::TRACK::${full.videoId}` as TrackUri<"youtube">,
            fetchedAt: new Date(),
            type: "track",
        };
        return {
            metadata,
            searchKeys: ["trackName+artistName"],
            query: [
                { label: "Search", value: query },
                {
                    label: "Kept",
                    value: `the best of the top ${candidates.length} songs (hit ${best.rank}, ${best.score}% as listed; at least ${MIN_SEARCH_CONFIDENCE}% needed)`,
                },
            ],
        };
    }

    /**
     * The video uploads, among the top hits, that look like `source` (at least `MIN_VIDEO_CONFIDENCE`), best first, at
     * most `MAX_VIDEOS`. A video's channel is its "artist" ("DiscoFactory") and the real artist is in the title
     * ("AutoReverse - Reflections (She Said Disco Remix)"): the title is read before it is compared.
     */
    private bestVideos(hits: VideoHit[], source: TrackMetadata, query: string, songId?: string): SearchTrackResult[] {
        const candidates = hits.slice(0, SEARCH_CANDIDATES);
        return candidates
            .map((hit, index) => {
                const metadata = this.videoHitToTrack(hit);
                return { hit, metadata, rank: index + 1, score: computeConfidenceScore(metadata, source) };
            })
            .filter(({ hit, score }) => score >= MIN_VIDEO_CONFIDENCE && hit.videoId !== songId)
            .sort((a, b) => b.score - a.score)
            .slice(0, MAX_VIDEOS)
            .map(({ hit, metadata, rank, score }) => ({
                metadata,
                searchKeys: ["trackName+artistName"],
                query: [
                    { label: "Search", value: `${query} (videos)` },
                    {
                        label: "Kept",
                        value: `a video upload by "${hit.artist?.name ?? "?"}" (hit ${rank} of ${candidates.length} videos, ${score}% as listed; at least ${MIN_VIDEO_CONFIDENCE}% needed, shown after the songs)`,
                    },
                ],
            }));
    }

    /** One video of a YouTube Music search, as the app's metadata: the artist and title are read out of the video's title. */
    private videoHitToTrack(video: VideoHit): TrackMetadata {
        const title = cleanVideoTitle(video.name);
        const split = splitArtistAndTitle(title, video.artist?.name);
        return {
            id: video.videoId,
            isrc: undefined,
            trackName: split?.track ?? title,
            duration: video.duration ? video.duration * 1000 : undefined,
            trackNumber: undefined,
            url: `https://www.youtube.com/watch?v=${video.videoId}`,
            uri: `YOUTUBE::TRACK::${video.videoId}` as TrackUri<"youtube">,
            isUpload: true,
            album: undefined,
            artists: split ? [{ type: "artist", name: split.artist }] : channelArtists(video.artist),
            platform: "youtube",
            apiProvider: "youtube",
            fetchedAt: new Date(),
            type: "track",
        };
    }

    async searchTrack(sourceTrackMetadata: TrackMetadata): Promise<SearchTrackResult[]> {
        const artist = sourceTrackMetadata.artists?.[0]?.name;
        const trackName = sourceTrackMetadata.trackName;

        if (!artist || !trackName) {
            throw new Error("Artist name and track name are required for search");
        }

        this.status.set({
            type: StatusType.Processing,
            message: "Searching YouTube Music",
            timeTracking: true,
            progress: 0,
        });

        try {
            const query = `${trackName} ${artist}`;

            this.logger.debug(`Searching YouTube Music with query: ${query}`);
            const client = await this.getClient();
            // Songs (the catalogue) and videos (anyone's upload: a remix a DJ posted, a track no label released) are two
            // searches of YouTube Music. A video search that fails must not lose the songs.
            const [songHits, videoHits] = await Promise.all([
                client.searchSongs(query),
                client.searchVideos(query).catch((error) => {
                    this.logger.warn("YouTube Music video search failed", { error });
                    return [] as VideoHit[];
                }),
            ]);

            if (songHits.length === 0 && videoHits.length === 0) {
                throw new Error(`No YouTube Music results found for: ${query}`);
            }

            // Songs first: a catalogue recording is the safer download. The videos come after (and are only used when
            // nothing above them can be downloaded), each one only if it looks like the track.
            const song = await this.bestSong(songHits, sourceTrackMetadata, query);
            const videos = this.bestVideos(videoHits, sourceTrackMetadata, query, song?.metadata.id);
            this.logger.info(
                `YouTube Music: ${song ? 1 : 0} song(s) and ${videos.length} video(s) look like the track ` +
                    `(of ${songHits.length} songs and ${videoHits.length} videos)`
            );

            this.status.clear();
            return [...(song ? [song] : []), ...videos];
        } catch (error) {
            this.logger.error(`Error searching YouTube Music for: ${sourceTrackMetadata.trackName}`, { error });
            this.status.set({
                type: StatusType.Error,
                message: "Error searching YouTube Music",
            });
            throw error;
        }
    }
}
