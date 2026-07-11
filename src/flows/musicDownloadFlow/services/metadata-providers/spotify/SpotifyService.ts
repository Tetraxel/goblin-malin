import { SpotifyApi, Track } from "@spotify/web-api-ts-sdk";
import { ProviderDisplay } from "#base/providerDisplay";
import { ProviderSettingsSchema } from "#base/providerSettings";
import { SetupWizardConfig } from "#base/setupWizard";
import { ParsedUrl, CollectionExpansion } from "#base/urlParser";
import { Task } from "#base/task/task";
import { Cached } from "#utils/cache";
import { Logger } from "#base/logger/logger";
import { StatusType } from "#base/task/task-status";
import { StandardTrack, TrackMetadata, TrackUri, SearchTrackResult } from "#flows/musicDownloadFlow/types";
import { DownloadTask } from "#flows/musicDownloadFlow/utils/downloadTask";
import { SpotifyCell } from "./SpotifyCell";
import { MetadataService } from "../../../metadataService";
import { getSpotifyEmbedDetails } from "../../apis/spotify-url-info-client";
import { convertSpotifyUrlInfoToTrack } from "./convertSpotifyUrlInfoToTrack";
import { getMetadataProviderSettings } from "../../../saveSettings";

export type SpotifyTokenResponse = {
    access_token: string;
    token_type: string;
    expires_in: number;
};

export type SpotifyArtistSimple = {
    id: string;
    name: string;
    type: "artist";
    external_urls: { spotify: string };
    href: string;
    uri: string;
};

export type SpotifyAlbumSimple = {
    id: string;
    album_type: "album" | "single" | "compilation";
    name: string;
    release_date: string;
    artists: SpotifyArtistSimple[];
    external_urls: { spotify: string };
};

export type SpotifyTrackResponse = {
    id: string;
    name: string;
    album: SpotifyAlbumSimple;
    artists: SpotifyArtistSimple[];
    external_urls: { spotify: string };
    href: string;
    uri: string;
    track_number: number;
    disc_number: number;
    duration_ms: number;
    explicit: boolean;
    is_local: boolean;
    popularity: number; // 0-100
    preview_url: string | null;
    type: "track";
};

export type SpotifyPlaylistTrackResponse = {
    href: string;
    limit: number;
    next: string | null;
    offset: number;
    previous: string | null;
    total: number;
    items: {
        added_at: string;
        track: SpotifyTrackResponse;
    }[];
};

type SpotifyAuthMode = "official" | "scrape";

export class SpotifyService extends MetadataService {
    static readonly display: ProviderDisplay = {
        label: "Spotify",
        acronym: "SP",
        color: "#1ed760",
        colorSubtle: "#156b30",
        colorBright: "#1db954",
    };
    static readonly defaultSettings: ProviderSettingsSchema = {
        enabled: { label: "Enable", defaultValue: true, kind: "checkbox" },
        fallbackToWeb: {
            label: "Fallback on scraped Spotify Web if API is unavailable",
            defaultValue: true,
            kind: "checkbox",
        },
    };
    static readonly setupWizard: SetupWizardConfig = {
        title: "⚙  Spotify Setup Wizard",
        providerKey: "spotify",
        providerType: "metadata",
        envSection: { name: "SPOTIFY", url: "https://developer.spotify.com/dashboard" },
        description: [],
        fields: [], // empty — fields live in modes
        modeEnvVar: "SPOTIFY_AUTH_MODE",
        modes: [
            {
                id: "official",
                label: "Official Spotify API (needs Premium account)",
                description: "Best metadata (album, ISRC, track number).",
                details: [
                    {
                        type: "note",
                        text: "You need a Premium Spotify Account to access the Spotify API.",
                    },
                    {
                        type: "paragraph",
                        text: "Steps to setup Spotify API access:",
                    },
                    {
                        type: "orderedList",
                        items: [
                            {
                                type: "link",
                                text: "Log in to the Spotify Developer Dashboard",
                                url: "https://developer.spotify.com/dashboard",
                            },
                            { type: "text", text: 'Click "Create app"' },
                            { type: "text", text: "Copy the CLIENT_ID and CLIENT_SECRET from the app page" },
                        ],
                    },
                ],
                fields: [
                    { envVar: "SPOTIFY_CLIENT_ID", label: "CLIENT_ID", hint: "e.g. b94c59cdcd…" },
                    { envVar: "SPOTIFY_CLIENT_SECRET", label: "CLIENT_SECRET", hint: "e.g. fa5a8a70ab…" },
                ],
            },
            {
                id: "scrape",
                label: "Scraped Spotify Web page (reads public page)",
                description: "Limited metadata (no album, no ISRC).\nMay break if Spotify changes embed page.",
                fields: [],
            },
        ],
    };
    static readonly cellComponent = SpotifyCell;

    private static client: SpotifyApi | null = null;
    private static authMode: SpotifyAuthMode | null = null;

    constructor(task: DownloadTask, logger: Logger) {
        super("SpotifyService", task, logger);
    }

    private async resolveAuth(): Promise<void> {
        return this.runExclusive("init", async () => {
            if (SpotifyService.authMode !== null) return;
            await this.env.getVariablesWithWizard(SpotifyService.setupWizard);
            const mode = (process.env.SPOTIFY_AUTH_MODE ?? "official") as SpotifyAuthMode;
            SpotifyService.authMode = mode;
            if (mode === "official") {
                SpotifyService.client = SpotifyApi.withClientCredentials(
                    process.env.SPOTIFY_CLIENT_ID!,
                    process.env.SPOTIFY_CLIENT_SECRET!
                );
            }
        });
    }

    private async getClient(): Promise<SpotifyApi> {
        await this.resolveAuth();
        if (!SpotifyService.client) {
            throw new Error("Spotify client not initialized (scrape mode active)");
        }
        return SpotifyService.client;
    }

    /**
     * Fetches track details from the Spotify API.
     *
     * @param trackId - The Spotify Track ID.
     * @returns The track data or null on failure.
     */
    @Cached()
    async getTrackInfo(trackId: string): Promise<Track | null> {
        const client = await this.getClient();

        try {
            this.logger.info(`Get track info: "${trackId}"…`);
            this.status.set({
                type: StatusType.Processing,
                message: "Get spotify track info",
                timeTracking: true,
                progress: 0,
            });

            const trackData: Track = await client.tracks.get(trackId);

            this.status.clear();
            return trackData;
        } catch (error) {
            this.logger.error(`Error fetching Spotify track info for ID ${trackId}:`, { error });
            this.status.set({
                type: StatusType.Error,
                message: "Error fetching Spotify track info",
            });
            throw error;
        }
    }

    // Converts Spotify Track to Standard Track format
    convertSpotifyTrack(spotifyTrack: Track, spotifyUrl: string): StandardTrack {
        return {
            id: spotifyTrack.id,
            isrc: spotifyTrack.external_ids?.isrc,
            trackName: spotifyTrack.name,
            duration: spotifyTrack.duration_ms,
            trackNumber: spotifyTrack.track_number,
            url: spotifyUrl,
            uri: spotifyTrack.uri,
            album: {
                id: spotifyTrack.album.id,
                albumType: spotifyTrack.album.album_type,
                albumName: spotifyTrack.album.name,
                totalTracks: spotifyTrack.album.total_tracks,
                releaseDate: spotifyTrack.album.release_date,
                url: spotifyTrack.album.external_urls?.spotify || "",
                uri: spotifyTrack.album.uri || `spotify:album:${spotifyTrack.album.id}`,
                artists: spotifyTrack.album.artists.map((artist) => ({
                    id: artist.id,
                    type: "artist" as const,
                    name: artist.name,
                    url: artist.external_urls?.spotify,
                    uri: artist.uri || `spotify:artist:${artist.id}`,
                })),
            },
            artists: spotifyTrack.artists.map((artist) => ({
                id: artist.id,
                type: "artist" as const,
                name: artist.name,
                url: artist.external_urls?.spotify,
                uri: artist.uri || `spotify:artist:${artist.id}`,
            })),
        };
    }

    static parseUrl(url: string): ParsedUrl | null {
        let parsed: URL;
        try {
            parsed = new URL(url);
        } catch {
            return null;
        }
        const host = parsed.hostname.replace(/^www\./, "");
        if (host !== "open.spotify.com" && !host.endsWith(".spotify.com")) return null;
        const path = parsed.pathname;
        const trackMatch = path.match(/\/(?:intl-[a-z]{2}\/)?track\/([a-zA-Z0-9]+)/);
        if (trackMatch) return { platform: "spotify", type: "track", id: trackMatch[1] };
        const albumMatch = path.match(/\/album\/([a-zA-Z0-9]+)/);
        if (albumMatch) return { platform: "spotify", type: "album", id: albumMatch[1] };
        const playlistMatch = path.match(/\/playlist\/([a-zA-Z0-9]+)/);
        if (playlistMatch) return { platform: "spotify", type: "playlist", id: playlistMatch[1] };
        return null;
    }

    /**
     * Resolve an album/playlist URL to its track listing. Deliberately NOT wrapped in
     * @Cached() — a live-refreshing playlist must see fresh results on every refetch,
     * and the app-level disk cache has no invalidation for that. `task` only needs to
     * be Task-shaped (getStatus/getPrompt/logger) — a CollectionTask qualifies without
     * being a DownloadTask, so the cast below is safe.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    static async expandCollection(url: string, logger: Logger, task: Task<any>): Promise<CollectionExpansion> {
        const parsed = SpotifyService.parseUrl(url);
        if (!parsed?.id || (parsed.type !== "album" && parsed.type !== "playlist")) {
            throw new Error(`Not a Spotify album/playlist URL: ${url}`);
        }

        // Reuses the instance's resolveAuth()/getClient() (incl. the setup wizard and
        // the cross-instance runExclusive dedup) so this shares auth state with every
        // regular track fetch instead of duplicating it.
        const instance = new SpotifyService(task as unknown as DownloadTask, logger);
        const client = await instance.getClient();

        return parsed.type === "playlist"
            ? SpotifyService.expandPlaylist(client, parsed.id)
            : SpotifyService.expandAlbum(client, parsed.id);
    }

    private static async expandPlaylist(client: SpotifyApi, id: string): Promise<CollectionExpansion> {
        const playlist = await client.playlists.getPlaylist(id, undefined, "name,owner.display_name,tracks.total");
        const total = playlist.tracks.total;

        const PAGE_SIZE = 50;
        const trackUrls: string[] = [];
        let skipped = 0;
        for (let offset = 0; offset < total; offset += PAGE_SIZE) {
            const page = await client.playlists.getPlaylistItems(id, undefined, undefined, PAGE_SIZE, offset);
            for (const item of page.items) {
                // Local files and episodes aren't fetchable tracks — skip and count them.
                if (item.is_local || item.track?.type !== "track") {
                    skipped++;
                    continue;
                }
                trackUrls.push(`https://open.spotify.com/track/${item.track.id}`);
            }
            if (page.items.length < PAGE_SIZE) break;
        }

        return {
            kind: "playlist",
            name: playlist.name,
            ownerName: playlist.owner?.display_name,
            trackUrls,
            totalCount: total - skipped,
        };
    }

    private static async expandAlbum(client: SpotifyApi, id: string): Promise<CollectionExpansion> {
        const album = await client.albums.get(id);
        const total = album.total_tracks;

        const PAGE_SIZE = 50;
        const trackUrls: string[] = [];
        for (let offset = 0; offset < total; offset += PAGE_SIZE) {
            const page = await client.albums.tracks(id, undefined, PAGE_SIZE, offset);
            for (const track of page.items) {
                if (track.is_local) continue;
                trackUrls.push(`https://open.spotify.com/track/${track.id}`);
            }
            if (page.items.length < PAGE_SIZE) break;
        }

        return {
            kind: "album",
            name: album.name,
            ownerName: album.artists[0]?.name,
            trackUrls,
            totalCount: trackUrls.length,
        };
    }

    private async fetchViaUrlInfo(url: string, trackId: string, isFallback: boolean): Promise<TrackMetadata> {
        this.logger.info(`Fetching Spotify track via spotify-url-info: "${trackId}"…`);
        this.status.set({
            type: StatusType.Processing,
            message: "Get spotify track info (embed)",
            timeTracking: true,
            progress: 0,
        });
        try {
            const details = await getSpotifyEmbedDetails(url);
            this.status.clear();
            return convertSpotifyUrlInfoToTrack(url, details, { isFallback });
        } catch (error) {
            this.logger.error(`Error fetching Spotify track via spotify-url-info for ID ${trackId}:`, { error });
            this.status.set({
                type: StatusType.Error,
                message: "Error fetching Spotify track info (embed)",
            });
            throw error;
        }
    }

    @Cached()
    async getTrackMetadata(url: string): Promise<TrackMetadata> {
        await this.resolveAuth();

        const trackId = SpotifyService.parseUrl(url)?.id;
        if (!trackId) {
            throw new Error(`Invalid Spotify track URL: ${url}`);
        }

        const mode = SpotifyService.authMode ?? "official";

        if (mode === "scrape") {
            // User deliberately chose scrape mode — this is the primary source, not a fallback.
            return this.fetchViaUrlInfo(url, trackId, false);
        }

        // Official mode — try the API, fall back to embed scraping
        try {
            const spotifyTrack = await this.getTrackInfo(trackId);
            if (!spotifyTrack) {
                throw new Error(`Could not fetch Spotify track: ${trackId}`);
            }

            const standardTrack = this.convertSpotifyTrack(spotifyTrack, url);

            const metadata: TrackMetadata = {
                ...standardTrack,
                platform: "spotify",
                apiProvider: "spotify",
                uri: `SPOTIFY::TRACK::${spotifyTrack.id}` as TrackUri<"spotify">,

                fetchedAt: new Date(),
                type: "track",
            };

            return metadata;
        } catch (error) {
            // Only fall back to the public embed page if the user opted into it. When disabled we
            // surface the API failure instead of silently degrading metadata.
            const fallbackEnabled = getMetadataProviderSettings("spotify").fallbackToWeb !== false;
            if (!fallbackEnabled) {
                this.logger.error(`Official Spotify API failed for "${trackId}" and Spotify Web fallback is disabled`, {
                    error,
                });
                throw error;
            }
            this.logger.warn(`Official Spotify API failed for "${trackId}", falling back to spotify-url-info`, {
                error,
            });
            return this.fetchViaUrlInfo(url, trackId, true);
        }
    }

    async searchTrack(sourceTrackMetadata: TrackMetadata): Promise<SearchTrackResult[]> {
        await this.resolveAuth();

        const mode = SpotifyService.authMode ?? "official";
        if (mode === "scrape") {
            throw new Error(
                "Spotify search is not available in scrape mode. Switch to official API mode for search support."
            );
        }

        const client = await this.getClient();

        const artist = sourceTrackMetadata.artists?.[0]?.name;
        const trackName = sourceTrackMetadata.trackName;

        if (!artist || !trackName) {
            throw new Error("Artist name and track name are required for search");
        }

        this.status.set({
            type: StatusType.Processing,
            message: "Searching Spotify",
            timeTracking: true,
            progress: 0,
        });

        try {
            const hasIsrc = !!sourceTrackMetadata.isrc;
            let query = `${trackName} artist:${artist}`;
            if (hasIsrc) query = query.concat(` isrc:${sourceTrackMetadata.isrc}`);

            const searchResults = await client.search(
                query,
                ["track"],
                "FR", // TODO: make country code configurable
                1
            );

            if (!searchResults.tracks?.items || searchResults.tracks.items.length === 0) {
                throw new Error(`No Spotify results found for: ${query}`);
            }

            const spotifyTrack = searchResults.tracks.items[0];
            const spotifyUrl = spotifyTrack.external_urls?.spotify || "";
            const standardTrack = this.convertSpotifyTrack(spotifyTrack, spotifyUrl);

            const metadata: TrackMetadata = {
                ...standardTrack,
                platform: "spotify",
                apiProvider: "spotify",
                uri: `SPOTIFY::TRACK::${spotifyTrack.id}` as TrackUri<"spotify">,
                fetchedAt: new Date(),
                type: "track",
            };

            this.status.clear();
            return [
                {
                    metadata,
                    searchKeys: hasIsrc ? ["trackName+artistName+isrc"] : ["trackName+artistName"],
                },
            ];
        } catch (error) {
            this.logger.error(`Error searching Spotify for: ${sourceTrackMetadata.trackName}`, { error });
            this.status.set({
                type: StatusType.Error,
                message: "Error searching Spotify",
            });
            throw error;
        }
    }
}
