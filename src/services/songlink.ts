import { Cached } from '../utils/cache';
import { ServiceBase } from '../base/service-base';
import { StatusType } from '../base/task/task-status';
import { Task } from '../base/task/task';
import { Logger } from '../base/logger/logger';
import { SonglinkClient, SonglinkResponse } from './apis/songlink-client';
import { sleep } from '../utils/sleep';


export class SonglinkService extends ServiceBase {
    private static client: SonglinkClient;

    constructor(task: Task, logger: Logger) {
        super('Songlink', task, logger)
    }

    private async getClient(): Promise<SonglinkClient> {
        return await this.runExclusive('init', async () => {
            if (!SonglinkService.client) {
                SonglinkService.client = new SonglinkClient();
            }
            return SonglinkService.client;
        });
    }

    @Cached()
    async getSonglinkData(url: string): Promise<SonglinkResponse | null> {
        const client = await this.getClient()

        try {
            this.logger.info(
                `Get Songlink track info: "${url}"`
            );
            this.status.set({
                type: StatusType.Processing,
                message: "Get Songlink track info",
                timeTracking: true,
                progress: 0,
            });

            // Prepare request
            const queryParams = new URLSearchParams({
                url,
                userCountry: 'FR',
                songIfSingle: 'true'
            });

            // Fetch from client
            this.status.update({ progress: 20 });
            const data = await client.get(queryParams);

            if (!data) {
                throw new Error('Failed to fetch data from Songlink client.');
            }

            this.logger.info("Successfully fetched Songlink data")
            this.status.update({ progress: 100 });
            return data;
        } catch (error) {
            this.logger.error(
                `Error fetching Songlink track data ${url}`,
                { error }
            );
            this.status.set({
                type: StatusType.Error,
                message: "Error fetching Songlink track",
            });

            throw error;
        }
    }
}
