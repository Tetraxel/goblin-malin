import { SpotifyApi, Track } from "@spotify/web-api-ts-sdk";
import { ServiceBase } from '../base/service-base';
import { Cached } from '../utils/cache';
import { Task } from "../base/task/task";
import { Logger } from "../base/logger/logger";
import { StatusType } from "../base/task/task-status";

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
    album_type: 'album' | 'single' | 'compilation';
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

export class SpotifyService extends ServiceBase {
    private static client: SpotifyApi;

    constructor(task: Task, logger: Logger) {
        super('SpotifyService', task, logger)
    }

    private async getClient(): Promise<SpotifyApi> {
        // Ensure only one initialization at a time
        return this.runExclusive('init', async () => {
            if (!SpotifyService.client) {
                const clientId = await this.env.getVariable('SPOTIFY_CLIENT_ID');
                const clientSecret = await this.env.getVariable('SPOTIFY_CLIENT_SECRET');
                SpotifyService.client = SpotifyApi.withClientCredentials(clientId, clientSecret);
            }
            return SpotifyService.client
        });
    }

    /**
     * Fetches track details from the Spotify API.
     *
     * @param trackId - The Spotify Track ID.
     * @returns The track data or null on failure.
     */
    @Cached()
    async getTrackInfo(
        trackId: string
    ): Promise<Track | null> {
        const client = await this.getClient()

        try {
            this.logger.info(
                `Get track info: "${trackId}"...`
            );
            this.status.set({
                type: StatusType.Processing,
                message: "Get spotify track info",
                timeTracking: true,
                progress: 0,
            });

            const trackData: Track = await client.tracks.get(trackId);

            this.status.update({ progress: 100 });
            return trackData;
        } catch (error: any) {
            this.logger.error(`Error fetching Spotify track info for ID ${trackId}:`, { error });
            this.status.set({
                type: StatusType.Error,
                message: "Error fetching Spotify track info",
            });
            return null;
        }
    }
}
