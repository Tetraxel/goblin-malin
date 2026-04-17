import fs from 'fs';
import path from 'path';
import { FormatOptions, QualityOptions, YtDlp } from 'ytdlp-nodejs';
import { DownloadService } from '../../downloadService';
import { Task } from '../../../../base/task/task';
import { StatusType } from '../../../../base/task/task-status';
import { Logger } from '../../../../base/logger/logger';
import { BIN_DIR, DOWNLOAD_DIR, PROJECT_ROOT } from '../../../../constants';
import { ensureYtDlpSetup } from '../../../../utils/ytdlp-setup';
import { ensureFfmpeg } from '../../../../utils/ffmpeg-setup';
import { APIProvider, TrackMetadata, TrackDownloadSource, LocalFile } from '../../types';
import { DownloadTask } from '../../utils/downloadTask';


export class YtDlpService extends DownloadService {
    public compatibleMetadataProviders: APIProvider[] = ['youtube', 'soundcloud'];
    private static client: YtDlp;

    constructor(task: DownloadTask, logger: Logger) {
        super('YtDlp', task, logger)
    }

    private async getClient(): Promise<YtDlp> {
        return this.runExclusive('init', async () => {
            if (!YtDlpService.client) {
                const ytDlpBinaryPath = await ensureYtDlpSetup()
                const ffmpefBinaryPath = await ensureFfmpeg()
                const ytDlpClient = new YtDlp({
                    binaryPath: ytDlpBinaryPath,
                    ffmpegPath: ffmpefBinaryPath,
                });
                YtDlpService.client = ytDlpClient
            }
            return YtDlpService.client
        });
    }

    async downloadTrack(trackMetadata: TrackMetadata): Promise<TrackDownloadSource> {
        // Check if this service can handle the track's source
        if (!this.canDownload(trackMetadata)) {
            throw new Error(`YtDlpService cannot download from ${trackMetadata.apiProvider}. Compatible providers: ${this.compatibleMetadataProviders.join(', ')}`);
        }

        const trackUrl = trackMetadata.url;

        try {
            this.logger.info(`Downloading track from ${trackMetadata.apiProvider}: ${trackMetadata.trackName}`);
            this.status.set({
                type: StatusType.Processing,
                message: `Downloading ${trackMetadata.trackName}`,
                timeTracking: true,
                progress: 0,
            });

            // Generate output filename from track metadata
            const artistName = trackMetadata.artists?.[0]?.name || 'Unknown Artist';
            const outputName = `${artistName} - ${trackMetadata.trackName}`;
            const format = 'flac';
            const filename = `${outputName}.${format}`;
            const fullPath = path.join(DOWNLOAD_DIR, filename);

            // Check if file already exists
            let localFile: LocalFile;
            if (fs.existsSync(fullPath)) {
                this.logger.info(`File already exists, skipping download: ${filename}`);
                localFile = {
                    state: 'found',
                    path: fullPath,
                    name: outputName,
                    extension: 'flac',
                    sourceUrl: trackUrl,
                };
            } else {
                // Ensure download directory exists
                if (!fs.existsSync(DOWNLOAD_DIR)) {
                    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
                }

                // Load cookies if available
                const cookiesPath = path.join(BIN_DIR, 'cookies.txt');
                let downloadOptions: FormatOptions<keyof QualityOptions> = {
                    paths: DOWNLOAD_DIR,
                    output: filename,
                    audioFormat: format,
                    extractAudio: true,
                    restrictFilenames: true,
                    onProgress: (progress) => {
                        this.status.update({ progress: progress.percentage });
                        this.logger.debug(`Download progress: ${progress.percentage}% ${progress.speed_str} (ETA: ${progress.eta_str})`);
                    },
                };

                // Add cookies if the file exists
                if (fs.existsSync(cookiesPath)) {
                    this.logger.debug(`Using cookies from ${cookiesPath}`);
                    downloadOptions.cookies = cookiesPath;
                }
                else {
                    this.logger.warn('No cookies file found, proceeding without cookies');
                }

                // Download the track
                const client = await this.getClient();
                await client.downloadAsync(trackUrl, downloadOptions);

                this.logger.info(`Successfully downloaded: ${filename}`);
                localFile = {
                    state: 'found',
                    path: fullPath,
                    name: outputName,
                    extension: 'flac',
                    sourceUrl: trackUrl,
                };
            }

            this.status.clear();

            // Create and return TrackDownloadSource
            const downloadSource: TrackDownloadSource = {
                state: 'downloaded',
                provider: 'ytdlp',
                track: trackMetadata,
                localFile,
                downloadedAt: new Date(),
                selected: true,
            };
            return downloadSource;
        } catch (error) {
            this.logger.error(`Error downloading track: ${trackMetadata.trackName}`, { error });
            this.status.set({
                type: StatusType.Error,
                message: `Failed to download ${trackMetadata.trackName}`,
            });
            throw error;
        }
    }

    // -------- OLD IMPLEMENTATION TO REWORK WITH NEW TYPE --------

    // public async downloadTrack(url: string, outputName: string) {
    //     const client = await this.getClient()
    //     try {
    //         this.logger.info(
    //             `Downloading youtube link: '${url}'…`
    //         );
    //         this.status.set({
    //             type: StatusType.Processing,
    //             message: "Downloading youtube link",
    //             timeTracking: true,
    //             progress: 0,
    //         });
    //         const format = 'flac'
    //         const filename = `${outputName}.${format}`
    //         const fullPath = path.join(DOWNLOAD_DIR, filename)

    //         if (fs.existsSync(fullPath)) {
    //             this.logger.info(`File already exists, bypassing download: '${filename}'`);
    //         }
    //         else {
    //             await client.downloadAsync(
    //                 url,
    //                 {
    //                     paths: DOWNLOAD_DIR,
    //                     output: filename,
    //                     audioFormat: format,
    //                     extractAudio: true,
    //                     restrictFilenames: true,
    //                     onProgress: (progress) => {
    //                         this.status.update({ progress: progress.percentage });
    //                         this.logger.info(`${progress.percentage} ${progress.speed_str} (${progress.eta_str})`);
    //                     },
    //                 }
    //             );
    //             this.logger.info(`Download completed: '${filename}'`);
    //         }
    //         this.status.update({ progress: 100 });
    //         return fullPath
    //     } catch (error) {
    //         this.logger.error('Error downloading youtube link:', { error });
    //         this.status.set({
    //             type: StatusType.Error,
    //             message: "Error downloading youtube link",
    //         });
    //         throw error
    //     }
    // }
}
