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
import { Platform, SonglinkResponse } from '../../../services/apis/songlink-client';
import { globalLogger, Logger } from "../../../base/logger/logger";
import { StatusType } from "../../../base/task/task-status";
import { convertSonglinkToTrack } from './convertSonglinkToTrack';
import { DownloadTaskAttributes, Source, StandardTrack } from "../types";
import { saveJsonFile } from '../../../utils/json';
import { replaceAll } from '../../../utils/string';


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

            this.logger.info(`Fetched track metadata ${track.artists[0]?.name} - ${track.trackName} (${(track?.duration ?? 0) / 1000}s)`);

            // Step 2: Download the track
            const localTrackPath = await this.downloadTrack(track);
            if (!localTrackPath)
                throw new Error("No candidate url for download")
            track.localRelativePath = path.relative(PROJECT_ROOT, localTrackPath);
            this.setAttributes({ track });

            // Step 3: Musicbrainz
            await this.fetchMusicBrainz(track)

            // Step 4: Mark as complete
            this.logger.info(`Successfully completed ${this.getInitialInput()}`)
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

        const url = this.getInitialInput()
        if (!url)
            throw new Error('No initial input')


        const sources: DownloadTaskAttributes['sources'] = []

        // OFTEN DOWN
        // // Try to get metadata from Songlink first
        // const songlinkResponse = await this.songlinkService.getSonglinkData(url);
        // if (songlinkResponse) {
        //     try {
        //         const track = await convertSonglinkToTrack(songlinkResponse, this.spotifyService, this.youtubeService);
        //         sources.push({
        //             platform: 'songlink',
        //             track,
        //             fetchedAt: new Date(),
        //         });
        //     } catch (error) {
        //         // Continue
        //     }
        // }

        // If spotify url, try spotify API
        if (url.includes('.spotify.com/')) {
            const spotifyTrackId = this.spotifyService.extractTrackIdFromUrl(url);

            if (spotifyTrackId) {
                try {
                    const spotifyTrack = await this.spotifyService.getTrackInfo(spotifyTrackId);
                    if (spotifyTrack) {
                        const spotifyUrl = `https://open.spotify.com/track/${spotifyTrackId}`;
                        const track = this.spotifyService.convertSpotifyTrack(spotifyTrack, spotifyUrl);
                        sources.push({
                            platform: 'spotify',
                            track,
                            fetchedAt: new Date(),
                        });
                    }
                } catch (error) {
                    // Continue
                }
            }
        }


        // Select the best source
        const track = sources[0]?.track
        if (!track)
            throw new Error('No track metadata found from the provided URL')
        this.setAttributes({ track, sources });
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


    private async fetchMusicBrainz(track: StandardTrack): Promise<void> {
        const artist = track.artists?.[0]
        const album = track.album
        if (!artist)
            return
        const MB_CHARS = '()_-'
        const artistName = replaceAll(artist.name, MB_CHARS, '');
        const trackName = replaceAll(track.trackName, MB_CHARS, ' ');
        const albumName = album?.albumName;
        const trackDuration: number | undefined = track.duration ?? undefined

        const musicBrainzReleases = await this.musicBrainzService.searchTracks(artistName, trackName, albumName, trackDuration);
        // await saveJsonFile('samples/musicBrainzReleases.json', musicBrainzReleases);
        track.musicBrainzRecording = musicBrainzReleases[0] ?? null;
        this.setAttributes({ track });
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
