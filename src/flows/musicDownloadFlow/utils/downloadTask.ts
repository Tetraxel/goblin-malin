import path from 'path';
import fs from 'fs/promises';
import { PROJECT_ROOT } from "../../../constants";
import { Task } from "../../../base/task/task";
import { MusicBrainzService } from '../services/metadata-providers/musicbrainz';
import { SpotifyService } from "../services/metadata-providers/spotify";
import { SoulseekService } from "../services/download-providers/soulseek";
import { YtDlpService } from "../services/download-providers/ytdlp";
import { YoutubeService } from '../services/metadata-providers/youtube';
import { SonglinkService } from "../services/metadata-providers/songlink";
import { Platform, SonglinkResponse } from '../services/apis/songlink-client';
import { globalLogger, Logger } from "../../../base/logger/logger";
import { StatusType } from "../../../base/task/task-status";
import { convertSonglinkToTrack } from './convertSonglinkToTrack';
import { MusicDownloadTaskAttributes, StandardTrack, TrackMetadata, TrackDownloadSource, MetadataSourceState } from "../types";
import { saveJsonFile } from '../../../utils/json';
import { replaceAll } from '../../../utils/string';
import { ServiceBase } from '../../../base/service-base';
import { MetadataService } from '../metadataService';
import { DownloadService } from '../downloadService';
import { ServiceRegistry } from '../../../base/service-registry';
import { ServiceScope } from '../../../base/service-scope';
import { computeConfidenceScore } from './confidence';


export class DownloadTask extends Task<MusicDownloadTaskAttributes> {
    private metadataServices: ServiceScope<DownloadTask, MetadataService>;
    private downloadServices: ServiceScope<DownloadTask, DownloadService>;

    // private songlinkService: SonglinkService;
    // private musicBrainzService: MusicBrainzService;
    // private spotifyService: SpotifyService;
    // private soulseekService: SoulseekService;
    // private ytDlpService: YtDlpService;
    // private youtubeService: YoutubeService;

    constructor(
        {
            id,
            initialInput,
            attributes,
            flowId,
            logger,
            metadataServiceRegistry,
            downloadServiceRegistry
        }: {
            id: string;
            initialInput?: string;
            attributes?: MusicDownloadTaskAttributes,
            flowId: string,
            logger: Logger,
            metadataServiceRegistry: ServiceRegistry<DownloadTask, MetadataService>,
            downloadServiceRegistry: ServiceRegistry<DownloadTask, DownloadService>,
        }) {
        super({ id, initialInput, attributes, flowId, logger });
        // this.songlinkService = new SonglinkService(this, this.logger);
        // this.musicBrainzService = new MusicBrainzService(this, this.logger);
        // this.spotifyService = new SpotifyService(this, this.logger);
        // this.soulseekService = new SoulseekService(this, this.logger);
        // this.ytDlpService = new YtDlpService(this, this.logger);
        // this.youtubeService = new YoutubeService(this, this.logger);

        this.metadataServices = metadataServiceRegistry.createScope(this, this.logger);
        this.downloadServices = downloadServiceRegistry.createScope(this, this.logger);
    }

    private getPrimaryMetadata(): TrackMetadata | undefined {
        return this.getAttributes()?.metadataSources.find(s => s.metadata.isPrimarySource)?.metadata;
    }

    private addMetadataSource(metadata: TrackMetadata): void {
        const current = this.getAttributes()?.metadataSources ?? [];
        const primary = this.getPrimaryMetadata();
        const confidence = metadata.isPrimarySource || !primary
            ? 100
            : computeConfidenceScore(metadata, primary);
        const state: MetadataSourceState = {
            metadata,
            rank: current.length,
            isFavorited: false,
            isRejected: false,
            confidence,
        };
        this.updateAttributes({ metadataSources: [...current, state] });
    }

    private upsertMetadataSource(metadata: TrackMetadata): void {
        const current = this.getAttributes()?.metadataSources ?? [];
        const existingIndex = current.findIndex(source => source.metadata.platform === metadata.platform);
        const primary = this.getPrimaryMetadata();
        const confidence = metadata.isPrimarySource || !primary
            ? undefined
            : computeConfidenceScore(metadata, primary);
        if (existingIndex >= 0) {
            const updated = [...current];
            updated[existingIndex] = { ...updated[existingIndex], metadata, confidence };
            this.updateAttributes({ metadataSources: updated });
        } else {
            this.addMetadataSource(metadata);
        }
    }

    async start(): Promise<void> {
        try {
            if (this.getAttributes()?.state !== 'pending') {
                this.logger.info(`Skipping because task already processed ${this.getInitialInput()}`);
                return;
            }

            this.logger.info(`Starting to process ${this.getInitialInput()}`);
            this.updateAttributes({ state: 'running' });

            if (this.getAttributes()?.toTag) {
                // If primary metadata is not fetched -> fetch it
                if (!this.getPrimaryMetadata()) {
                    await this.startPrimaryMetadataFetching();
                }

                await this.startMetadataDiscovering();
            }

            if (this.getAttributes()?.toDownload) {
                await this.startDownloads();
            }
            this.updateAttributes({ state: 'finished' });
        } catch (error) {
            this.updateAttributes({ state: 'failed' });
            throw error;
        }

        // Old implementation

        // // Step 1: Determine source and fetch metadata
        // const track = await this.fetchTrackMetadata();

        // this.logger.info(`Fetched track metadata ${track.artists[0]?.name} - ${track.trackName} (${(track?.duration ?? 0) / 1000}s)`);

        // // Step 2: Download the track
        // const localTrackPath = await this.downloadTrack(track);
        // if (!localTrackPath)
        //     throw new Error("No candidate url for download")
        // track.localRelativePath = path.relative(PROJECT_ROOT, localTrackPath);
        // this.setAttributes({ track });

        // // Step 3: Musicbrainz
        // await this.fetchMusicBrainz(track)

        // // Step 4: Mark as complete
        // this.logger.info(`Successfully completed ${this.getInitialInput()}`)
        // this.status.set({
        //     type: StatusType.Success,
        //     message: "Completed",
        //     progress: 100,
        // });
    }

    async startPrimaryMetadataFetching(): Promise<TrackMetadata> {
        const url = this.getAttributes()?.userInput.url;

        if (!url) {
            throw new Error('No user input URL provided');
        }

        this.logger.info(`Fetching primary metadata for URL: ${url}`);

        const services = this.metadataServices.getAllServices();
        for (const service of services) {
            try {
                // Check if this service can handle the URL
                const type = service.getType(url);
                if (type === 'track') {
                    this.logger.debug(`Fetching metadata using ${service.constructor.name}`);

                    const metadata = await service.getTrackMetadata(url);

                    metadata.isPrimarySource = true;
                    this.addMetadataSource(metadata);
                    this.logger.info(`Successfully fetched primary metadata from ${metadata.apiProvider}`);
                    return metadata;
                }
            } catch (error) {
                this.logger.warn(`Failed to fetch metadata from ${service.constructor.name}:`, { error });
            }
        }

        throw new Error(`No metadata service could handle the URL: ${url}`);
    }

    // Search metadata from all other providers using the primary metadata as source of truth
    // (e.g. using track name, artist name, isrc, etc) to find the best matching metadata
    async startMetadataDiscovering(): Promise<void> {
        // Get the primary metadata source to use for searching
        const primaryMetadata = this.getPrimaryMetadata();

        if (!primaryMetadata) {
            throw new Error('No primary metadata source available for metadata discovering');
        }

        this.logger.info(`Discovering metadata from all other sources using primary metadata`);
        this.updateAttributes({ metadataDiscovering: true });

        try {
            const services = this.metadataServices.getAllServices();
            for (const service of services) {
                try {
                    // Skip the primary source provider to avoid duplicate metadata
                    if (service.id === primaryMetadata.id) {
                        this.logger.debug(`Skipping primary source provider: ${service.id}`);
                        continue;
                    }

                    this.logger.debug(`Searching for track using ${service.id}`);

                    // Use isrc, track name, artist name, etc to improve search results
                    const metadata = await service.searchTrack(primaryMetadata);

                    metadata.isPrimarySource = false;
                    this.upsertMetadataSource(metadata);
                    this.logger.info(`Successfully discovered metadata from ${metadata.apiProvider}`);
                } catch (error) {
                    this.logger.warn(`Failed to discover metadata from ${service.constructor.name}:`, { error });
                    // Continue to next service on failure
                }
            }
        } finally {
            this.updateAttributes({ metadataDiscovering: false });
        }
    }

    // Allow re-searching metadata from a specific provider (e.g. after user has marked a metadata source as rejected or not favorited)
    async startSingleProviderSearch(serviceKey: string): Promise<void> {
        const primaryMetadata = this.getPrimaryMetadata();
        if (!primaryMetadata) {
            this.logger.warn('No primary metadata available for re-search');
            return;
        }
        try {
            const service = this.metadataServices.get(serviceKey);
            const metadata = await service.searchTrack(primaryMetadata);
            metadata.isPrimarySource = false;
            this.upsertMetadataSource(metadata);
            this.logger.info(`Re-search completed for ${serviceKey}`);
        } catch (error) {
            this.logger.warn(`Failed to re-search ${serviceKey}:`, { error });
        }
    }


    async startDownloads(): Promise<void> {
        const metadataSources = this.getAttributes()?.metadataSources;

        if (!metadataSources || metadataSources.length === 0) {
            this.logger.warn('No metadata sources available for download');
            throw new Error('No metadata sources available for download');
        }

        this.logger.info(`Starting downloads with ${metadataSources.length} metadata sources`);

        const downloadServices = this.downloadServices.getAllServices();
        const downloadSources: TrackDownloadSource[] = [];

        for (const downloadService of downloadServices) {
            try {
                // Find the first compatible metadata source for this download service
                // TODO: trying multiple metadata sources for the same download service to compare audio files
                const compatibleSource = metadataSources.find((source) =>
                    downloadService.canDownload(source.metadata)
                );

                if (!compatibleSource) {
                    this.logger.warn(
                        `No compatible metadata source found for ${downloadService.id}. Compatible providers: ${downloadService.compatibleMetadataProviders.join(', ')}`
                    );
                    continue;
                }

                const compatibleMetadata = compatibleSource.metadata;
                this.logger.info(`Downloading using ${downloadService.id} from ${compatibleMetadata.apiProvider}`);

                // Download the track
                const downloadSource = await downloadService.downloadTrack(compatibleMetadata);
                downloadSources.push(downloadSource);

                this.logger.info(`Successfully downloaded using ${downloadService.id}`);
            } catch (error) {
                this.logger.warn(`Failed to download using ${downloadService.id}:`, { error });
                // Continue to next download service
            }
        }

        // Update task attributes with download sources
        this.updateAttributes({ downloadSources });

        if (downloadSources.length === 0) {
            this.logger.warn('No successful downloads');
        } else {
            this.logger.info(`Completed downloads: ${downloadSources.filter((s) => s.state === 'downloaded').length} successful, ${downloadSources.filter((s) => s.state === 'failed').length} failed`);
        }
    }

    // ------- OLD IMPLEMENTATION BELOW - TO BE REWORKED -------

    // // Fetch metadata from appropriate service
    // private async fetchTrackMetadata(): Promise<StandardTrack> {
    //     this.logger.info(`fetchMetadata`);
    //     this.status.set({
    //         type: StatusType.Processing,
    //         message: "Fetch metadata",
    //         timeTracking: true,
    //         progress: 0,
    //     });

    //     const url = this.getInitialInput()
    //     if (!url)
    //         throw new Error('No initial input')


    //     const sources: MusicDownloadTaskAttributes['sources'] = []

    //     // OFTEN DOWN
    //     // // Try to get metadata from Songlink first
    //     // const songlinkResponse = await this.songlinkService.getSonglinkData(url);
    //     // if (songlinkResponse) {
    //     //     try {
    //     //         const track = await convertSonglinkToTrack(songlinkResponse, this.spotifyService, this.youtubeService);
    //     //         sources.push({
    //     //             platform: 'songlink',
    //     //             track,
    //     //             fetchedAt: new Date(),
    //     //         });
    //     //     } catch (error) {
    //     //         // Continue
    //     //     }
    //     // }

    //     // If spotify url, try spotify API
    //     if (url.includes('.spotify.com/')) {
    //         const spotifyTrackId = this.spotifyService.extractTrackIdFromUrl(url);

    //         if (spotifyTrackId) {
    //             try {
    //                 const spotifyTrack = await this.spotifyService.getTrackInfo(spotifyTrackId);
    //                 if (spotifyTrack) {
    //                     const spotifyUrl = `https://open.spotify.com/track/${spotifyTrackId}`;
    //                     const track = this.spotifyService.convertSpotifyTrack(spotifyTrack, spotifyUrl);
    //                     sources.push({
    //                         platform: 'spotify',
    //                         track,
    //                         fetchedAt: new Date(),
    //                     });
    //                 }
    //             } catch (error) {
    //                 // Continue
    //             }
    //         }
    //     }


    //     // Select the best source
    //     const track = sources[0]?.track
    //     if (!track)
    //         throw new Error('No track metadata found from the provided URL')
    //     this.setAttributes({ track, sources });
    // }

    // // Download the track
    // private async downloadTrack(track: StandardTrack): Promise<string | undefined> {
    //     const filename = `${track.artists[0].name} - ${track.trackName}`

    //     if (track.linksByPlatform?.["youtubeMusic"])
    //         return await this.ytDlpService.downloadTrack(track.linksByPlatform["youtubeMusic"], filename);

    //     // Fallback to downloading from youtube
    //     if (track.linksByPlatform?.["youtube"])
    //         return await this.ytDlpService.downloadTrack(track.linksByPlatform["youtube"], filename);
    // }


    // private async fetchMusicBrainz(track: StandardTrack): Promise<void> {
    //     const artist = track.artists?.[0]
    //     const album = track.album
    //     if (!artist)
    //         return
    //     const MB_CHARS = '()_-'
    //     const artistName = replaceAll(artist.name, MB_CHARS, '');
    //     const trackName = replaceAll(track.trackName, MB_CHARS, ' ');
    //     const albumName = album?.albumName;
    //     const trackDuration: number | undefined = track.duration ?? undefined

    //     const musicBrainzReleases = await this.musicBrainzService.searchTracks(artistName, trackName, albumName, trackDuration);
    //     // await saveJsonFile('samples/musicBrainzReleases.json', musicBrainzReleases);
    //     track.musicBrainzRecording = musicBrainzReleases[0] ?? null;
    //     this.setAttributes({ track });
    // }

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
