import { SpotifyApi, Track } from "@spotify/web-api-ts-sdk";
import { ServiceBase } from '../base/service-base';
import { Cached } from '../utils/cache';
import { Task } from "../base/task/task";
import { Logger } from "../base/logger/logger";
import { StatusType } from "../base/task/task-status";
import { StandardTrack } from "../flows/musicDownloadFlow/types";

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

    extractTrackIdFromUrl(url: string): string | null {
        const regex = /(?:https?:\/\/)?(?:open\.)?spotify\.com\/track\/([a-zA-Z0-9]+)(?:\?.*)?$/;
        const match = url.match(regex);
        return match ? match[1] : null;
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
                `Get track info: "${trackId}"…`
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
            throw error
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
                url: spotifyTrack.album.external_urls?.spotify || '',
                uri: spotifyTrack.album.uri || `spotify:album:${spotifyTrack.album.id}`,
                artists: spotifyTrack.album.artists.map(artist => ({
                    id: artist.id,
                    type: 'artist' as const,
                    name: artist.name,
                    url: artist.external_urls?.spotify,
                    uri: artist.uri || `spotify:artist:${artist.id}`
                }))
            },
            artists: spotifyTrack.artists.map(artist => ({
                id: artist.id,
                type: 'artist' as const,
                name: artist.name,
                url: artist.external_urls?.spotify,
                uri: artist.uri || `spotify:artist:${artist.id}`
            }))
        };
    }
}
