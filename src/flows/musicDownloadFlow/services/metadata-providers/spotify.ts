import { SpotifyApi, Track } from "@spotify/web-api-ts-sdk";
import { MetadataService } from '../../metadataService';
import { Cached } from '../../../../utils/cache';
import { Task } from "../../../../base/task/task";
import { Logger } from "../../../../base/logger/logger";
import { StatusType } from "../../../../base/task/task-status";
import { StandardTrack, TrackMetadata, TrackUri } from "../../types";
import { DownloadTask } from "../../utils/downloadTask";

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

export class SpotifyService extends MetadataService {
    private static client: SpotifyApi;

    constructor(task: DownloadTask, logger: Logger) {
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
                `Get track info: "${trackId}"…`
            );
            this.status.set({
                type: StatusType.Processing,
                message: "Get spotify track info",
                timeTracking: true,
                progress: 0,
            });

            const trackData: Track = await client.tracks.get(trackId);

            this.status.clear();
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

    getType(url: string): 'track' | undefined {
        const trackId = this.extractTrackIdFromUrl(url);
        return trackId ? 'track' : undefined;
    }

    extractTrackIdFromUrl(url: string): string | null {
        const regex = /(?:https?:\/\/)?(?:open\.)?spotify\.com\/(?:intl-[a-z]{2}\/)?track\/([a-zA-Z0-9]+)(?:\?.*)?$/;
        const match = url.match(regex);
        return match ? match[1] : null;
    }

    @Cached()
    async getTrackMetadata(url: string): Promise<TrackMetadata> {
        const trackId = this.extractTrackIdFromUrl(url);
        if (!trackId) {
            throw new Error(`Invalid Spotify track URL: ${url}`);
        }

        const spotifyTrack = await this.getTrackInfo(trackId);
        if (!spotifyTrack) {
            throw new Error(`Could not fetch Spotify track: ${trackId}`);
        }

        const standardTrack = this.convertSpotifyTrack(spotifyTrack, url);

        const metadata: TrackMetadata = {
            ...standardTrack,
            platform: 'spotify',
            apiProvider: 'spotify',
            uri: `SPOTIFY::TRACK::${spotifyTrack.id}` as TrackUri<'spotify'>,
            isPrimarySource: false,
            fetchedAt: new Date(),
            type: 'track',
        };

        return metadata;
    }

    async searchTrack(sourceTrackMetadata: TrackMetadata): Promise<TrackMetadata> {
        const client = await this.getClient();

        const artist = sourceTrackMetadata.artists?.[0]?.name;
        const trackName = sourceTrackMetadata.trackName;

        if (!artist || !trackName) {
            throw new Error('Artist name and track name are required for search');
        }

        this.status.set({
            type: StatusType.Processing,
            message: 'Searching Spotify',
            timeTracking: true,
            progress: 0,
        });

        try {
            let query = `${trackName} artist:${artist}`;

            if (sourceTrackMetadata.isrc)
                query = query.concat(` isrc:${sourceTrackMetadata.isrc}`)

            const searchResults = await client.search(
                query,
                ['track'],
                'FR', // TODO: make country code configurable
                1
            );

            if (!searchResults.tracks?.items || searchResults.tracks.items.length === 0) {
                throw new Error(`No Spotify results found for: ${query}`);
            }

            const spotifyTrack = searchResults.tracks.items[0];
            const spotifyUrl = spotifyTrack.external_urls?.spotify || '';
            const standardTrack = this.convertSpotifyTrack(spotifyTrack, spotifyUrl);

            const metadata: TrackMetadata = {
                ...standardTrack,
                platform: 'spotify',
                apiProvider: 'spotify',
                uri: `SPOTIFY::TRACK::${spotifyTrack.id}` as TrackUri<'spotify'>,
                isPrimarySource: false,
                fetchedAt: new Date(),
                type: 'track',
            };

            this.status.clear();
            return metadata;
        } catch (error: any) {
            this.logger.error(`Error searching Spotify for: ${sourceTrackMetadata.trackName}`, { error });
            this.status.set({
                type: StatusType.Error,
                message: 'Error searching Spotify',
            });
            throw error;
        }
    }
}
