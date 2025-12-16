import path from 'path';
import fs from 'fs/promises';
import { PROJECT_ROOT } from "../../../constants";
import { Task } from "../../../base/task/task";
import { MusicBrainzService } from '../../../services/musicbrainz';
import { SpotifyService } from "../../../services/spotify";
import { SoulseekService } from "../../../services/soulseek";
import { YtDlpService } from "../../../services/ytdlp";
import { YoutubeService } from '../../../services/youtube';
import { SonglinkService } from "../../../services/songlink";
import { SonglinkResponse } from '../../../services/apis/songlink-client';
import { Logger } from "../../../base/logger/logger";
import { StatusType } from "../../../base/task/task-status";
import { convertSonglinkToTrack } from './convertSonglinkToTrack';
import { StandardTrack } from "../types";


export type DownloadTaskAttributes = {
    track?: StandardTrack;
}

export class DownloadTask extends Task<DownloadTaskAttributes> {
    private songlinkService: SonglinkService;
    private musicBrainzService: MusicBrainzService;
    private spotifyService: SpotifyService;
    private soulseekService: SoulseekService;
    private ytDlpService: YtDlpService;
    private youtubeService: YoutubeService;

    constructor({ id, initialInput, attributes, flowId, logger }: {
        id: string; initialInput?: string; attributes?: DownloadTaskAttributes, flowId: string, logger: Logger
    }) {
        super({ id, initialInput, attributes, flowId, logger });
        this.songlinkService = new SonglinkService(this, this.logger);
        this.musicBrainzService = new MusicBrainzService(this, this.logger);
        this.spotifyService = new SpotifyService(this, this.logger);
        this.soulseekService = new SoulseekService(this, this.logger);
        this.ytDlpService = new YtDlpService(this, this.logger);
        this.youtubeService = new YoutubeService(this, this.logger);
    }

    async start(): Promise<void> {
        try {
            this.logger.info(`Starting to process ${this.getInitialInput()}`);

            // Step 1: Determine source and fetch metadata
            const track = await this.fetchTrackMetadata();
            this.logger.info(`Fetched track metadata ${track.artists[0]?.name} - ${track.trackName} (${track?.duration ?? 0 / 1000}s)`);

            // Step 2: Download the track
            // await fs.writeFile('samples/track.json', JSON.stringify(track, null, 2));
            const localTrackPath = await this.downloadTrack(track);
            if (!localTrackPath)
                throw new Error("No candidate url for download")
            track.localRelativePath = path.relative(PROJECT_ROOT, localTrackPath);
            this.setAttributes({ track });

            // Step 3: Musicbrainz
            const musicBrainzReleases = await this.musicBrainzService.searchTracks(track.artists?.[0].name, track.trackName, track.album?.albumName);
            await fs.writeFile('samples/musicBrainzReleases.json', JSON.stringify(musicBrainzReleases, null, 2));
            track.musicBrainzRecording = musicBrainzReleases[0] ?? null;
            this.setAttributes({ track });

            // Step 4: Mark as complete
            this.status.set({
                type: StatusType.Success,
                message: "Completed",
                progress: 100,
            });
        } catch (error) {
            throw error;
        }
    }

    async stop(): Promise<void> {
        // Not Implemented
    }

    // Fetch metadata from appropriate service
    private async fetchTrackMetadata(): Promise<StandardTrack> {
        this.logger.info(`fetchMetadata`);
        this.status.set({
            type: StatusType.Processing,
            message: "Fetch metadata",
            timeTracking: true,
            progress: 0,
        });

        try {
            // Try to get metadata from Songlink first
            const url = this.getInitialInput()
            if (!url)
                throw new Error('No initial input')

            const songlinkResponse = await this.songlinkService.getSonglinkData(url);
            if (!songlinkResponse)
                throw new Error('No response from api')

            const track = await convertSonglinkToTrack(songlinkResponse, this.spotifyService, this.youtubeService);
            this.setAttributes({ track });
            return track;
        } catch (error) {
            this.logger.error(`Songlink failed for ${this.getInitialInput()}: ${error}`);
            return { id: crypto.randomUUID(), trackName: 'Unknown', artists: [], url: "Unknown" };
        }
    }

    // Download the track
    private async downloadTrack(track: StandardTrack): Promise<string | undefined> {
        const filename = `${track.artists[0].name} - ${track.trackName}`

        if (track.linksByPlatform?.["youtubeMusic"])
            return await this.ytDlpService.downloadTrack(track.linksByPlatform["youtubeMusic"], filename);

        // Fallback to downloading from youtube
        if (track.linksByPlatform?.["youtube"])
            return await this.ytDlpService.downloadTrack(track.linksByPlatform["youtube"], filename);
    }

    // // Search on Soulseek
    // private async searchSoulseek(metadata: SongMetadata): Promise<any> {
    //     return await this.soulseekService.searchMusic({
    //         query: {
    //             artistName: metadata.artist,
    //             trackTitle: metadata.title,
    //             albumName: undefined,
    //             extension: undefined,
    //             durationMs: undefined,
    //         },
    //         waitTimeMs: 3000,
    //     });
    // }

    // // Download from Soulseek
    // private async downloadFromSoulseek(item: DownloadItem, results: any): Promise<void> {
    //     const { SoulseekService } = await import('./api/soulseek');
    //     const soulseek = SoulseekService.getInstance();

    //     await soulseek.download(results.file, (progress) => {
    //         this.updateItem(item.id, { progress });
    //     });
    // }
}
