import slsk from 'slsk-client';
import type { SlskFile, SoulseekClient } from 'slsk-client';
import fs from 'fs/promises';
import path from 'path';
import { Cached } from '../../../../../utils/cache';
import { DownloadService } from '../../../downloadService';
import { ProviderDisplay } from '../../../../../base/providerDisplay';
import { Logger } from '../../../../../base/logger/logger';
import { PROJECT_ROOT } from '../../../../../constants';
import { StatusType } from '../../../../../base/task/task-status';
import { DownloadTask } from '../../../utils/downloadTask';

const MAX_PREFERRED_SIZE = 50; // Files bigger than 50MB are less interesting
const DOWNLOAD_DIR = path.join(PROJECT_ROOT, 'soulseek-download');
const MAX_DOWNLOAD_ATTEMPTS = 5;

/**
 * Clean search terms by replacing special characters with spaces
 */
function cleanSearchTerm(term: string | undefined): string {
    if (!term)
        return ""
    return term.replace(/[\:"/\\|\?\*\(\)<>]/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseFilePath(filePath: string) {
    const folderPath = path.dirname(filePath)
    const fileExtension = path.extname(filePath).slice(1) // remove the dot
    const fileName = path.basename(filePath, `.${fileExtension}`)

    return {
        folderPath,
        fileName,
        fileExtension
    };
}

function contains(string1: string, string2: string) {
    return string1.toLowerCase().includes(string2.toLowerCase())
}

/**
 * Calculate a weight score for sorting results
 */
function calculateResultWeight(result: SlskFile, query: { artistName: string, trackTitle: string, albumName: string, extension: string }): number {
    let score = 0;
    const { folderPath, fileName, fileExtension } = parseFilePath(result.file);

    // Base requirements
    if (fileExtension !== query.extension) return -1;
    if (!result.slots) return -1;
    if (contains(fileName, 'remix') !== contains(query.trackTitle, 'remix')) return -1; // only if remix version requested

    // File attributes
    const sizeInMB = result.size / (1024 * 1024);
    score += sizeInMB > MAX_PREFERRED_SIZE
        ? Math.log(result.size) / 10 - (sizeInMB - MAX_PREFERRED_SIZE) / 10 // PENALTY if too big
        : Math.log(result.size) / 10; // BEST if reasonably big file
    score += result.bitrate ? result.bitrate / 2000 : 0; // BEST if high bitrate (kbps)
    score += Math.log(result.speed) / 20; // BEST if high speed

    // Bonus/Malus points
    if (contains(fileName, 'extended')) score *= 3.0; // BONUS for extended versions
    if (contains(fileName, "club mix")) score *= 2.0; // BONUS for club mix
    if (contains(fileName, query.trackTitle)) score *= 1.3; // BONUS if trackTitle in the fileName
    if (contains(folderPath, query.albumName)) score *= 1.3; // BONUS if albumName in the folderPath

    return score;
}


type QueryInput = {
    artistName: string;
    trackTitle: string;
    albumName?: string;
    extension?: string;
    durationMs?: number;
};

type SearchMusicInput = {
    query: QueryInput;
    waitTimeMs: number;
}

export class SoulseekService extends DownloadService {
    static readonly display: ProviderDisplay = { label: "Soulseek", acronym: "SOULSEEK", color: "#2700ff", colorSubtle: "#100080", colorBright: "#4040ff" };

    private static client: SoulseekClient;

    public constructor(task: DownloadTask, logger: Logger) {
        super('SoulseekService', task, logger)
    }

    private async getClient(): Promise<SoulseekClient> {
        // Ensure only one initialization at a time
        return this.runExclusive('init', async () => {
            if (!SoulseekService.client) {
                const username = await this.env.getVariable('SOULSEEK_USERNAME');
                const password = await this.env.getVariable('SOULSEEK_PASSWORD');
                SoulseekService.client = await new Promise((resolve, reject) => {
                    slsk.connect({
                        user: username,
                        pass: password,
                    }, (err: Error | null, client: any) => {
                        if (err) {
                            reject(err);
                            return;
                        }
                        resolve(client);
                    });
                });
            }
            return SoulseekService.client;
        });
    }

    @Cached()
    async searchMusic({ query, waitTimeMs }: SearchMusicInput): Promise<{ file: SlskFile, path: string | null } | null> {
        const client = await this.getClient()

        try {
            this.logger.info(
                `Search Soulseek music`
            );
            this.status.set({
                type: StatusType.Processing,
                message: "Search Soulseek music",
                timeTracking: true,
                progress: 0,
            });

            const artistName = query.artistName;
            const trackTitle = query.trackTitle;
            const albumName = query.albumName ?? "";
            const extension = query.extension ?? "flac";
            const searchQuery = cleanSearchTerm(`${artistName} ${trackTitle} .${extension}`);

            this.logger.info(`Searching Soulseek for: '${searchQuery}'`);
            this.status.update({ progress: 10 });

            return new Promise((resolve) => {
                client.search({
                    req: searchQuery,
                    timeout: waitTimeMs
                }, async (error: Error | null, res: SlskFile[]) => {
                    if (error) {
                        this.logger.error(
                            `Error searching Soulseek`, { error }
                        );
                        this.status.set({
                            type: StatusType.Error,
                            message: "Error searching Soulseek",
                        });
                        return;
                    }
                    if (!res || !res.length) {
                        this.logger.info('Search: 0 results');
                        this.status.update({ progress: 100 });
                        resolve(null);
                        return;
                    }

                    this.logger.info('received', { res })
                    this.status.update({ progress: 50 });

                    const sortedResults = res
                        .filter(result =>
                            result &&
                            result.file &&
                            result.user &&
                            result.file.toLowerCase().endsWith(extension) &&
                            result.slots && // available for download
                            (!result.bitrate || result.bitrate > 100) && // at least 100kbps (mp3 average)
                            result.speed > 100 // at least 100K/s
                        )
                        .map(result => ({
                            ...result,
                            weight: calculateResultWeight(result, { artistName, trackTitle, albumName, extension })
                        }))
                        .filter(result => result.weight >= 0)
                        .sort((a, b) => b.weight - a.weight)
                        .slice(0, MAX_DOWNLOAD_ATTEMPTS); // Only keep top 5 results

                    this.logger.info(`Found ${sortedResults.length} results:`);
                    sortedResults.forEach((result, index) => {
                        this.logger.info(`${index + 1}. [${result.weight.toFixed(2)}] ${result.file} (${result.user})`);
                    });

                    this.logger.info('sortedResults', { sortedResults })

                    this.logger.info(`Attempting downloads from ${sortedResults.length} results…`);
                    this.status.update({ progress: 70 });

                    // Try downloads sequentially
                    for (const [index, entry] of sortedResults.entries()) {
                        this.status.update({ progress: 70 + (index / sortedResults.length) * 25 });
                        const downloadPath = await this.tryDownload(entry);
                        if (downloadPath) {
                            const result = { file: entry, path: downloadPath };
                            this.status.update({ progress: 100 });
                            resolve(result);
                            return;
                        }
                    }

                    this.status.update({ progress: 100 });
                    resolve({ file: sortedResults[0], path: null });
                });
            });

        } catch (error) {
            this.logger.error(
                `Soulseek search error`,
                { error }
            );
            this.status.set({
                type: StatusType.Error,
                message: "Soulseek search error",
            });
            throw error
        }
    }

    @Cached()
    async tryDownload(file: SlskFile): Promise<string | null> {
        const client = await this.getClient()

        try {
            const filename = path.basename(file.file);
            const downloadPath = path.join(DOWNLOAD_DIR, filename);
            await fs.mkdir(DOWNLOAD_DIR, { recursive: true });
            this.logger.info('Attempting download', { file });

            return new Promise((resolve) => {
                client.download({
                    file,
                    path: downloadPath
                }, async (error: Error | null) => {
                    if (error) {
                        this.logger.error(`Failed to download from ${file.user}:`, { error });
                        resolve(null);
                        return;
                    }

                    this.logger.info(`Successfully downloaded: '${filename}'`);
                    resolve(downloadPath);
                });
            });
        } catch (error) {
            this.logger.error('Soulseek download error', { error });
            this.status.set({
                type: StatusType.Error,
                message: "Soulseek download error",
            });
            throw error
        }
    }
}
