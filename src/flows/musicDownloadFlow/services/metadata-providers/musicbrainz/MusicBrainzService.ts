// import { MusicBrainzApi, IReleaseGroup, IRecordingMatch, IReleaseGroupMatch, IRelease } from 'musicbrainz-api';
// import { MetadataService } from '../../../metadataService';
// import { ParsedUrl } from '../../../../../base/urlParser';
// import { StatusType } from '../../../../../base/task/task-status';
// import { Logger } from '../../../../../base/logger/logger';
// import { Cached } from '../../../../../utils/cache';
// import { DownloadTask } from '../../../utils/downloadTask';



// // TODO: add static cellComponent = MusicBrainzCell once MusicBrainz is activated.
// // Importing MusicBrainzCell here would create a circular dep since MusicBrainzCell
// // imports MusicBrainzRecording/MusicBrainzRelease from this file. Extract those
// // types to a shared types.ts in this folder to resolve it.

// export class MusicBrainzService extends MetadataService {
//     private static client: MusicBrainzApi;

//     constructor(task: DownloadTask, logger: Logger) {
//         super('MusicBrainzService', task, logger)
//     }

//     static parseUrl(_url: string): ParsedUrl | null { return null; }

//     private async getClient(): Promise<MusicBrainzApi> {
//         // Ensure only one initialization at a time
//         return this.runExclusive('init', async () => {
//             if (!MusicBrainzService.client) {
//                 this.logger.info(`Initializing MusicBrainz API client…`);

//                 MusicBrainzService.client = new MusicBrainzApi({
//                     appName: 'tetraxel-app',
//                     appVersion: '0.1.0',
//                     appContactInfo: 'https://github.com/tetraxel',
//                 });
//             }
//             return MusicBrainzService.client;
//         });
//     }

//     /**
//      * Searches for a release group (album, EP, etc.) by artist name and release group name.
//      * @param artistName The name of the artist (e.g., "Queen")
//      * @param albumName The name of the album/release group (e.g., "A Night at the Opera")
//      */
//     @Cached()
//     async searchAlbums(artistName: string, albumName: string): Promise<MusicBrainzReleaseGroup[]> {
//         const musicBrainzClient = await this.getClient()
//         try {
//             this.logger.info(
//                 `Searching for release group: "${albumName}" by "${artistName}"…`
//             );
//             this.status.set({
//                 type: StatusType.Processing,
//                 message: "Searching release",
//                 timeTracking: true,
//                 progress: 0,
//             });

//             // Search the 'release-group' entity
//             const results = await musicBrainzClient.search('release-group', {
//                 artist: artistName,
//                 query: {
//                     releasegroup: albumName,
//                 },
//             });

//             this.logger.info(`Found ${results.count} results for "${albumName}".`);
//             this.status.update({ progress: 75 });

//             results['release-groups'].forEach((rg: IReleaseGroup) => {
//                 this.logger.info(`- [${rg.id}] ${rg['primary-type']}: ${rg.title}`);
//             });

//             this.status.update({ progress: 100 });
//             return results['release-groups'];
//         } catch (error) {
//             this.logger.error('Error searching for release:', { error });
//             this.status.set({
//                 type: StatusType.Error,
//                 message: "Error searching release",
//             });
//             throw error
//         }
//     }

//     /**
//      * Searches for a recording (track) by artist name, track title, and optionally album name.
//      * @param artistName The name of the artist (e.g., "Nirvana")
//      * @param trackName The title of the track (e.g., "Smells Like Teen Spirit")
//      * @param albumName (Optional) The name of the album/release (e.g., "Nevermind")
//      */
//     // @Cached()
//     async searchTracks(
//         artistName: string,
//         trackName: string,
//         albumName?: string,
//         trackDuration?: number, // ms
//     ): Promise<MusicBrainzRecording[]> {
//         const musicBrainzClient = await this.getClient()

//         try {
//             this.logger.info(
//                 `\nSearching for track: "${trackName}" by "${artistName}"`
//                 + (albumName ? ` on album "${albumName}"` : '')
//                 + (trackDuration ? ` (${(trackDuration / 1000)}s)` : '')
//                 + '…'
//             );
//             this.status.set({
//                 type: StatusType.Processing,
//                 message: "Searching track",
//                 timeTracking: true,
//                 progress: 0,
//             });

//             // Search tracks
//             const results = await musicBrainzClient.search('recording', {
//                 query: {
//                     artist: artistName,
//                     recording: trackName,
//                     ...(albumName ? { release: albumName } : {}),
//                     ...(trackDuration ? { dur: trackDuration } : {}),
//                 }
//             });

//             this.logger.info(`Found ${results.count} results for "${trackName}".`);
//             this.status.update({ progress: 100 });
//             return results.recordings;
//         } catch (error) {
//             this.logger.error('Error searching for track:', { error });
//             this.status.set({
//                 type: StatusType.Error,
//                 message: "Error searching for track",
//             });
//             throw error;
//         }
//     }
// }
