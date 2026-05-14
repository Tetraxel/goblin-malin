import path from 'path';
import fs from 'fs/promises';
import { PROJECT_ROOT } from "../../../constants";
import { Task } from "../../../base/task/task";
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
import { computeCompiledMetadata } from './compiledMetadata';
import { compiledMetadataToTags } from './compiledMetadataToTags';
import { computeOutputPath } from './computeOutputPath';
import { cleanAndTagFlac } from '../../../utils/metadata';
import { getSaveSettings } from '../saveSettings';


export class DownloadTask extends Task<MusicDownloadTaskAttributes> {
    private metadataServices: ServiceScope<DownloadTask, MetadataService>;
    private downloadServices: ServiceScope<DownloadTask, DownloadService>;

    constructor(
        {
            id,
            initialInput,
            attributes,
            flowId,
            logger,
            metadataServiceRegistry,
            downloadServiceRegistry,
            isMetadataEnabled,
            isDownloadEnabled,
        }: {
            id: string;
            initialInput?: string;
            attributes?: MusicDownloadTaskAttributes,
            flowId: string,
            logger: Logger,
            metadataServiceRegistry: ServiceRegistry<DownloadTask, MetadataService>,
            downloadServiceRegistry: ServiceRegistry<DownloadTask, DownloadService>,
            isMetadataEnabled: (key: string) => boolean,
            isDownloadEnabled: (key: string) => boolean,
        }) {
        super({ id, initialInput, attributes, flowId, logger });

        this.metadataServices = metadataServiceRegistry.createScope(this, this.logger, isMetadataEnabled);
        this.downloadServices = downloadServiceRegistry.createScope(this, this.logger, isDownloadEnabled);
    }

    private getPrimaryMetadata(): MetadataSourceState | undefined {
        return this.getAttributes()?.metadataSources.find(s => s.isPrimarySource);
    }

    private sortMetadataSourcesByConfidence(sources: MetadataSourceState[]): MetadataSourceState[] {
        return [...sources].sort((a, b) => a.isPrimarySource ? -1 : (b.confidence ?? 0) - (a.confidence ?? 0));
    }

    private addMetadataSource(metadata: TrackMetadata, isPrimary: boolean): void {
        var currentMetadataSources = this.getAttributes()?.metadataSources ?? [];
        // Keep only one primary source: if the metadata inserted is primary, remove the old one
        if (isPrimary)
            currentMetadataSources = currentMetadataSources.filter(s => !s.isPrimarySource);

        const primary = this.getPrimaryMetadata()?.metadata;
        const confidence = isPrimary || !primary
            ? 100
            : computeConfidenceScore(metadata, primary);

        const existingSourceIndex = currentMetadataSources.findIndex(source => source.metadata.platform === metadata.platform);

        // Update existing source
        if (existingSourceIndex !== -1) {
            currentMetadataSources[existingSourceIndex] = { ...currentMetadataSources[existingSourceIndex], metadata, isPrimarySource: isPrimary, confidence };
        }
        // Add new source
        else {
            const newSource: MetadataSourceState = {
                metadata,
                isPrimarySource: isPrimary,
                rank: currentMetadataSources.length,
                isFavorited: false,
                isRejected: false,
                confidence,
            };
            currentMetadataSources = [...currentMetadataSources, newSource];
        }

        const sorted = this.sortMetadataSourcesByConfidence(currentMetadataSources);
        this.updateAttributes({ metadataSources: sorted });
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

    async startPrimaryMetadataFetching(): Promise<void> {
        const url = this.getAttributes()?.userInput.url;

        if (!url) {
            throw new Error('No user input URL provided');
        }

        this.logger.info(`Fetching primary metadata for URL: ${url}`);
        const nonPrimarySources = (this.getAttributes()?.metadataSources ?? []).filter(s => !s.isPrimarySource);
        this.updateAttributes({ metadataSources: nonPrimarySources, primaryMetadataInProgress: true, primaryMetadataFetched: false });

        try {
            const services = this.metadataServices.getAllServices();

            for (const service of services) {
                try {
                    // Check if this service can handle the URL
                    const type = service.getType(url);
                    if (type === 'track') {
                        this.logger.debug(`Fetching metadata using ${service.constructor.name}`);

                        const metadata = await service.getTrackMetadata(url);
                        this.addMetadataSource(metadata, true);
                        this.logger.info(`Successfully fetched primary metadata from ${metadata.apiProvider}`);
                        break;
                    }
                } catch (error) {
                    this.logger.warn(`Failed to fetch metadata from ${service.constructor.name}:`, { error });
                }
            }

            if (!this.getPrimaryMetadata()) {
                this.status.update({ type: StatusType.Error, message: 'Primary metadata unavailable' });
                this.logger.error(`No metadata service could fetch primary metadata for the URL: ${url}`);
                throw new Error(`No metadata service could fetch metadata for the URL: ${url}`);
            }
        } finally {
            this.updateAttributes({ primaryMetadataInProgress: false });
        }
        this.updateAttributes({ primaryMetadataFetched: true });
    }

    // Search metadata from all other providers using the primary metadata as source of truth
    // (e.g. using track name, artist name, isrc, etc) to find the best matching metadata
    async startMetadataDiscovering(): Promise<void> {
        // Get the primary metadata source to use for searching
        const primarySource = this.getPrimaryMetadata();

        if (!primarySource || !primarySource.metadata) {
            throw new Error('No primary metadata source available for metadata discovering');
        }

        this.logger.info(`Discovering metadata from all other sources using primary metadata`);
        this.updateAttributes({ metadataSources: [primarySource], metadataDiscoveringInProgress: true, metadataDiscovered: false });

        try {
            const services = this.metadataServices.getAllServices();
            for (const service of services) {
                try {
                    this.logger.debug(`Searching for track using ${service.id}`);

                    // Use isrc, track name, artist name, etc to improve search results
                    const metadata = await service.searchTrack(primarySource.metadata);

                    // Skip if discovered metadata is the same as the primary source
                    if (primarySource && (
                        metadata.platform === primarySource.metadata.platform ||
                        metadata.apiProvider === primarySource.metadata.apiProvider
                    )) {
                        this.logger.debug(`Skipping discovered metadata from ${service.id}: conflicts with primary source`);
                        continue;
                    }

                    this.addMetadataSource(metadata, false);
                    this.logger.info(`Successfully discovered metadata from ${metadata.apiProvider}`);
                } catch (error) {
                    this.logger.warn(`Failed to discover metadata from ${service.constructor.name}:`, { error });
                    // Continue to next service on failure
                }
            }
        } finally {
            this.updateAttributes({ metadataDiscoveringInProgress: false });
        }
        this.updateAttributes({ metadataDiscovered: true });
    }

    // Allow re-searching metadata from a specific provider (e.g. after user has marked a metadata source as rejected or not favorited)
    async startSingleProviderSearch(serviceKey: string): Promise<void> {
        const primaryMetadata = this.getPrimaryMetadata()?.metadata;
        if (!primaryMetadata) {
            this.logger.warn('No primary metadata available for re-search');
            return;
        }
        try {
            const service = this.metadataServices.get(serviceKey);
            const metadata = await service.searchTrack(primaryMetadata);
            this.addMetadataSource(metadata, false);
            this.logger.info(`Re-search completed for ${serviceKey}`);
        } catch (error) {
            this.logger.warn(`Failed to re-search ${serviceKey}:`, { error });
        }
    }

    async restart(): Promise<void> {
        this.updateAttributes({
            state: 'pending',
            metadataSources: [],
            metadataOverride: {},
            downloadSources: [],
            primaryMetadataFetched: false,
            metadataDiscovered: false,
            downloadsFetched: false,
        });
        await this.start();
    }

    selectDownloadSource(index: number): void {
        const sources = this.getAttributes()?.downloadSources ?? [];
        this.updateAttributes({
            downloadSources: sources.map((s, i) => ({ ...s, selected: i === index })),
        });
    }

    rejectDownloadSource(index: number, rejected: boolean): void {
        const sources = this.getAttributes()?.downloadSources ?? [];
        if (!sources[index]) return;
        this.updateAttributes({
            downloadSources: sources.map((s, i) =>
                i === index
                    ? { ...s, isRejected: rejected, selected: rejected ? false : s.selected }
                    : s
            ),
        });
    }

    updateLocalFile(sourceIndex: number, newPath: string): void {
        const sources = this.getAttributes()?.downloadSources ?? [];
        if (!sources[sourceIndex]) return;
        const updated = sources.map((s, i) => {
            if (i !== sourceIndex) return s;
            return {
                ...s,
                localFile: {
                    ...s.localFile!,
                    path: newPath,
                    state: 'found' as const,
                    name: newPath.split(/[\\/]/).pop()?.replace(/\.[^/.]+$/, '') ?? s.localFile?.name ?? '',
                },
            };
        });
        this.updateAttributes({ downloadSources: updated });
    }

    async saveTrack(): Promise<void> {
        const attrs = this.getAttributes();
        const sources = attrs?.downloadSources ?? [];
        const selectedSource = sources.find(s => s.selected);

        if (!selectedSource) throw new Error('No download source selected');
        if (selectedSource.localFile?.state !== 'found') throw new Error('Local file not found');

        const settings = getSaveSettings();
        globalLogger.info('Saving track with settings:', { settings });

        const compiled = computeCompiledMetadata(
            attrs!.metadataSources,
            attrs!.metadataOverride,
        );
        const tags = compiledMetadataToTags(compiled, {
            includeMusicBrainzTags: settings.includeMusicBrainzTags,
        });
        const outputPath = computeOutputPath(compiled, settings.outputDir);

        this.status.update({ type: StatusType.Processing, message: 'Saving…' });

        const existingSavedPath = selectedSource.savedFile?.path ?? null;
        let outputCreated = false;

        try {
            // Delete saved files from other sources (they're being replaced)
            for (const src of sources) {
                if (src !== selectedSource && src.savedFile) {
                    try { await fs.unlink(src.savedFile.path); } catch (e: any) { if (e.code !== 'ENOENT') throw e; }
                }
            }

            if (existingSavedPath) {
                // Re-saving same source: rename to new path if it changed, otherwise just re-tag
                if (existingSavedPath !== outputPath) {
                    const { moveFile } = await import('../../../utils/metadata');
                    await moveFile(existingSavedPath, outputPath);
                }
                outputCreated = true;
            } else {
                // New source: copy temp file to output dir
                await fs.copyFile(selectedSource.localFile!.path, outputPath);
                outputCreated = true;
            }

            await cleanAndTagFlac(outputPath, tags);

            this.updateAttributes({
                downloadSources: sources.map(s =>
                    s === selectedSource
                        ? { ...s, savedFile: { path: outputPath, savedAt: new Date() } }
                        : { ...s, savedFile: undefined }
                ),
            });

            this.status.set({ type: StatusType.Success, message: 'Saved' });
        } catch (err) {
            if (outputCreated) {
                await fs.unlink(outputPath).catch(() => { });
            }
            this.status.set({ type: StatusType.Error, message: 'Save failed' });
            throw err;
        }
    }

    async startDownloads(): Promise<void> {
        const metadataSources = this.getAttributes()?.metadataSources;

        if (!metadataSources || metadataSources.length === 0) {
            this.logger.warn('No metadata sources available for download');
            throw new Error('No metadata sources available for download');
        }

        this.logger.info(`Starting downloads with ${metadataSources.length} metadata sources`);
        this.updateAttributes({ downloadSources: [], downloadsFetched: false });

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

        // Only the first successfully downloaded source is auto-selected
        const firstDownloadedIdx = downloadSources.findIndex(s => s.state === 'downloaded');
        const sourcesWithSelection = downloadSources.map((s, i) => ({
            ...s,
            selected: i === firstDownloadedIdx,
        }));

        this.updateAttributes({ downloadSources: sourcesWithSelection });
        this.updateAttributes({ downloadsFetched: true });

        if (downloadSources.length === 0) {
            this.logger.warn('No successful downloads');
        } else {
            this.logger.info(`Completed downloads: ${downloadSources.filter((s) => s.state === 'downloaded').length} successful, ${downloadSources.filter((s) => s.state === 'failed').length} failed`);
        }
    }

    // ------- OLD IMPLEMENTATION BELOW - TO BE REWORKED -------

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
