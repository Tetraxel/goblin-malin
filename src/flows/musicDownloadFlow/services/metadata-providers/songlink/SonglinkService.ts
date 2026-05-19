// import { ParsedUrl } from '#base/urlParser';
// import { Logger } from '#base/logger/logger';
// import { StatusType } from '#base/task/task-status';
// import { DownloadTask } from '#flows/musicDownloadFlow/utils/downloadTask';
// import { sleep } from '#utils/sleep';
// import { Cached } from '#utils/cache';
// import { MetadataService } from '../../../metadataService';
// import { SonglinkClient, SonglinkResponse } from '../../apis/songlink-client';

// export class SonglinkService extends MetadataService {
//     private static client: SonglinkClient;

//     constructor(task: DownloadTask, logger: Logger) {
//         super('Songlink', task, logger)
//     }

//     static parseUrl(_url: string): ParsedUrl | null { return null; }

//     private async getClient(): Promise<SonglinkClient> {
//         return await this.runExclusive('init', async () => {
//             if (!SonglinkService.client) {
//                 SonglinkService.client = new SonglinkClient();
//             }
//             return SonglinkService.client;
//         });
//     }

//     @Cached()
//     async getSonglinkData(url: string): Promise<SonglinkResponse | null> {
//         const client = await this.getClient()

//         try {
//             this.logger.info(
//                 `Get Songlink track info: "${url}"`
//             );
//             this.status.set({
//                 type: StatusType.Processing,
//                 message: "Get Songlink track info",
//                 timeTracking: true,
//                 progress: 0,
//             });

//             // Prepare request
//             const queryParams = new URLSearchParams({
//                 url,
//                 userCountry: 'FR',
//                 songIfSingle: 'true'
//             });

//             // Fetch from client
//             this.status.update({ progress: 20 });
//             const data = await client.get(queryParams);

//             if (!data) {
//                 throw new Error('Failed to fetch data from Songlink client.');
//             }

//             this.logger.info("Successfully fetched Songlink data")
//             this.status.update({ progress: 100 });
//             return data;
//         } catch (error) {
//             this.logger.error(
//                 `Error fetching Songlink track data ${url}`,
//                 { error }
//             );
//             this.status.set({
//                 type: StatusType.Error,
//                 message: "Error fetching Songlink track",
//             });

//             throw error;
//         }
//     }
// }
