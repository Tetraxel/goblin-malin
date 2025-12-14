import fs from 'fs';
import path from 'path';
import { YtDlp } from 'ytdlp-nodejs';
import { ServiceBase } from '../base/service-base';
import { Task } from '../base/task/task';
import { StatusType } from '../base/task/task-status';
import { Logger } from '../base/logger/logger';
import { DOWNLOAD_DIR } from '../constants';


export class YtDlpService extends ServiceBase {
    private static client: YtDlp;

    constructor(task: Task, logger: Logger) {
        super('YtDlp', task, logger)
    }

    private async getClient(): Promise<YtDlp> {
        return this.runExclusive('init', async () => {
            if (!YtDlpService.client) {
                const ytDlpClient = new YtDlp();
                YtDlpService.client = ytDlpClient
            }
            return YtDlpService.client
        });
    }

    public async downloadTrack(url: string, outputName: string) {
        const client = await this.getClient()
        try {
            this.logger.info(
                `Downloading youtube link: '${url}'...`
            );
            this.status.set({
                type: StatusType.Processing,
                message: "Downloading youtube link",
                timeTracking: true,
                progress: 0,
            });
            const format = 'flac'
            const filename = `${outputName}.${format}`
            const fullPath = path.join(DOWNLOAD_DIR, filename)

            if (fs.existsSync(fullPath)) {
                this.logger.info(`File already exists, bypassing download: '${filename}'`);
            }
            else {
                await client.downloadAsync(
                    url,
                    {
                        paths: DOWNLOAD_DIR,
                        output: filename,
                        audioFormat: format,
                        extractAudio: true,
                        restrictFilenames: true,
                        onProgress: (progress) => {
                            this.status.update({ progress: progress.percentage });
                            this.logger.info(`${progress.percentage} ${progress.speed_str} (${progress.eta_str})`);
                        },
                    }
                );
                this.logger.info(`Download completed: '${filename}'`);
            }
            this.status.update({ progress: 100 });
            return fullPath
        } catch (error) {
            this.logger.error('Error downloading youtube link:', { error });
            this.status.set({
                type: StatusType.Error,
                message: "Error downloading youtube link",
            });
        }
    }
}
