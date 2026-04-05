import YTMusic, {
    type SongDetailed,
    type SongFull,
    type VideoFull,
    type ArtistFull,
    type AlbumFull
} from 'ytmusic-api';
import fs from 'fs/promises';
import { ServiceBase } from '../base/service-base';
import { Task } from '../base/task/task';
import { StatusType } from '../base/task/task-status';
import { Logger } from '../base/logger/logger';
import { Cached } from '../utils/cache';


export class YoutubeService extends ServiceBase {
    private static client: YTMusic;

    constructor(task: Task, logger: Logger) {
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

    /**
     * Search YouTube Music for tracks matching a query
     * @param query - Search query string
     * @returns Array of detailed song results
     */
    @Cached()
    public async searchTracks(query: string): Promise<SongDetailed[]> {
        try {
            this.logger.info(`Searching YouTube Music for songs: "${query}"…`);
            this.status.set({
                type: StatusType.Processing,
                message: "Searching YouTube Music for songs",
                timeTracking: true,
                progress: 0,
            });

            const client = await this.getClient();
            const results = await client.searchSongs(query);

            await fs.writeFile('samples/youtubeSearchResults.json', JSON.stringify(results, null, 2));

            this.logger.info(`Successfully found ${results.length} tracks`);
            this.status.update({ progress: 100 });

            return results;
        } catch (error) {
            this.logger.error('Error searching songs:', { error });
            this.status.set({
                type: StatusType.Error,
                message: "Error searching songs",
            });
            throw new Error(`Song search failed: ${error}`);
        }
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
}
