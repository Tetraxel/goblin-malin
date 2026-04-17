import YTMusic, {
    type SongDetailed,
    type SongFull,
    type VideoFull,
    type ArtistFull,
    type AlbumFull
} from 'ytmusic-api';
import fs from 'fs/promises';
import { MetadataService } from '../../metadataService';
import { Task } from '../../../../base/task/task';
import { StatusType } from '../../../../base/task/task-status';
import { Logger } from '../../../../base/logger/logger';
import { Cached } from '../../../../utils/cache';
import { DownloadTask } from '../../utils/downloadTask';
import { StandardTrack, TrackMetadata, TrackUri } from '../../types';

export class YoutubeService extends MetadataService {
    private static client: YTMusic;

    constructor(task: DownloadTask, logger: Logger) {
        super('Youtube', task, logger);
    }

    private async getClient(): Promise<YTMusic> {
        return this.runExclusive('init', async () => {
            if (!YoutubeService.client) {
                const ytMusic = new YTMusic();
                await ytMusic.initialize();
                YoutubeService.client = ytMusic;
            }
            return YoutubeService.client;
        });
    }

    // /**
    //  * Search YouTube Music for tracks matching a query
    //  * @param query - Search query string
    //  * @returns Array of detailed song results
    //  */
    // @Cached()
    // public async searchTracks(query: string): Promise<SongDetailed[]> {
    //     try {
    //         this.logger.info(`Searching YouTube Music for songs: "${query}"…`);
    //         this.status.set({
    //             type: StatusType.Processing,
    //             message: "Searching YouTube Music for songs",
    //             timeTracking: true,
    //             progress: 0,
    //         });

    //         const client = await this.getClient();
    //         const results = await client.searchSongs(query);

    //         await fs.writeFile('samples/youtubeSearchResults.json', JSON.stringify(results, null, 2));

    //         this.logger.info(`Successfully found ${results.length} tracks`);
    //         this.status.update({ progress: 100 });

    //         return results;
    //     } catch (error) {
    //         this.logger.error('Error searching songs:', { error });
    //         this.status.set({
    //             type: StatusType.Error,
    //             message: "Error searching songs",
    //         });
    //         throw new Error(`Song search failed: ${error}`);
    //     }
    // }

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

            return song;
        } catch (error) {
            this.logger.error('Error getting song:', { error });
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

            return video;
        } catch (error) {
            this.logger.error('Error getting video:', { error });
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

            return artist;
        } catch (error) {
            this.logger.error('Error getting artist:', { error });
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

            return album;
        } catch (error) {
            this.logger.error('Error getting album:', { error });
            this.status.set({
                type: StatusType.Error,
                message: "Error fetching album data",
            });
            throw new Error(`Failed to get album: ${error}`);
        }
    }

    public getType(url: string): 'track' | undefined {
        const videoId = this.extractVideoIdFromUrl(url);
        return videoId ? 'track' : undefined;
    }

    public extractVideoIdFromUrl(url: string): string | null {
        // Match YouTube URLs: https://www.youtube.com/watch?v=ID or https://music.youtube.com/watch?v=ID
        const regex = /(?:https?:\/\/)?(?:www\.)?(?:music\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]+)/;
        const match = url.match(regex);
        return match ? match[1] : null;
    }

    @Cached()
    async getTrackMetadata(url: string): Promise<TrackMetadata> {
        const videoId = this.extractVideoIdFromUrl(url);
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
            artists: song.artist ? [{
                id: song.artist.artistId || '',
                type: 'artist' as const,
                name: song.artist.name,
                url: song.artist.artistId ? `https://music.youtube.com/browse/${song.artist.artistId}` : '',
                uri: `youtube:artist:${song.artist.artistId || song.artist.name}`
            }] : []
        };

        const metadata: TrackMetadata = {
            ...standardTrack,
            platform: 'youtube',
            apiProvider: 'youtube',
            uri: `YOUTUBE::TRACK::${song.videoId}` as TrackUri<'youtube'>,
            isPrimarySource: false,
            fetchedAt: new Date(),
            type: 'track',
        };

        return metadata;
    }

    async searchTrack(sourceTrackMetadata: TrackMetadata): Promise<TrackMetadata> {
        const artist = sourceTrackMetadata.artists?.[0]?.name;
        const trackName = sourceTrackMetadata.trackName;

        if (!artist || !trackName) {
            throw new Error('Artist name and track name are required for search');
        }

        this.status.set({
            type: StatusType.Processing,
            message: 'Searching YouTube Music',
            timeTracking: true,
            progress: 0,
        });

        try {
            const query = `${trackName} ${artist}`;

            this.logger.debug(`Searching YouTube Music with query: ${query}`);
            const client = await this.getClient();
            const results = await client.searchSongs(query);
            // const results = await this.searchTracks(query);

            if (!results || results.length === 0) {
                throw new Error(`No YouTube Music results found for: ${query}`);
            }

            // Get the first result's full metadata
            const firstResult = results[0];
            const song = await this.getSong(firstResult.videoId);

            // Convert to TrackMetadata
            const standardTrack: StandardTrack = {
                id: song.videoId,
                isrc: undefined,
                trackName: song.name,
                duration: song.duration ? song.duration * 1000 : undefined,
                trackNumber: undefined,
                url: `https://www.youtube.com/watch?v=${song.videoId}`,
                uri: `https://www.youtube.com/watch?v=${song.videoId}`,
                album: undefined,
                artists: song.artist ? [{
                    id: song.artist.artistId || '',
                    type: 'artist' as const,
                    name: song.artist.name,
                    url: song.artist.artistId ? `https://music.youtube.com/browse/${song.artist.artistId}` : '',
                    uri: `youtube:artist:${song.artist.artistId || song.artist.name}`
                }] : []
            };

            const metadata: TrackMetadata = {
                ...standardTrack,
                platform: 'youtube',
                apiProvider: 'youtube',
                uri: `YOUTUBE::TRACK::${song.videoId}` as TrackUri<'youtube'>,
                isPrimarySource: false,
                fetchedAt: new Date(),
                type: 'track',
            };

            this.status.clear();
            return metadata;
        } catch (error: any) {
            this.logger.error(`Error searching YouTube Music for: ${sourceTrackMetadata.trackName}`, { error });
            this.status.set({
                type: StatusType.Error,
                message: 'Error searching YouTube Music',
            });
            throw error;
        }
    }
}
