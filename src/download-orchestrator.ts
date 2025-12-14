import { EventEmitter } from 'events';
import { globalLogger, Logger } from './base/logger/logger';
import { MusicDownloadFlow } from './flows/musicDownloadFlow/musicDownloadFlow';
import { Task } from './base/task/task';
import { StatusType } from './base/task/task-status';

export class DownloadOrchestrator extends EventEmitter {
    private static instance: DownloadOrchestrator;
    private maxConcurrent: number = 1; // Tracks processed in parallel
    private activeDownloads: Set<string> = new Set();
    private queue: Task[] = [];
    private processing: boolean = false;
    protected logger: Logger;

    private constructor() {
        super();
        this.logger = globalLogger.createChild({ service: 'DownloadOrchestrator' });
    }

    static getInstance(): DownloadOrchestrator {
        if (!DownloadOrchestrator.instance) {
            DownloadOrchestrator.instance = new DownloadOrchestrator();
        }
        return DownloadOrchestrator.instance;
    }

    setMaxConcurrent(max: number): void {
        this.maxConcurrent = max;
    }

    // Add items to the download queue and start processing
    addToQueue(items: Task[]) {
        this.queue.push(...items);
    }

    // Start processing
    async startProcessing(): Promise<void> {
        if (!this.processing) {
            this.processing = true;
            await this.processQueue();
            this.processing = false;
        }
        else
            this.logger.warn('Download processing is already in progress.');
    }

    // Process the queue with parallel downloads
    private async processQueue(): Promise<void> {
        const promises: Promise<void>[] = [];

        while (this.queue.length > 0 || this.activeDownloads.size > 0) {
            // Start new downloads up to maxConcurrent
            while (
                this.queue.length > 0 &&
                this.activeDownloads.size < this.maxConcurrent
            ) {
                const task = this.queue.shift();
                if (!task) break;
                this.activeDownloads.add(task.getId());

                const musicDownloadflow = new MusicDownloadFlow(this.logger, task);

                // Start processing without awaiting (parallel execution)
                const promise = musicDownloadflow.start()
                    .catch((error: Error) => {
                        task.getStatus().set({
                            type: StatusType.Error,
                            message: "Failed to process task",
                        });
                        this.logger.error(`Failed to process ${task.getId()} ${task.getInitialInput()}: ${error.message}`, { stack: error.stack });
                    })
                    .finally(() => {
                        this.activeDownloads.delete(task.getId());
                    });

                promises.push(promise);
            }

            // Wait for at least one download to complete before continuing
            if (this.activeDownloads.size >= this.maxConcurrent) {
                await Promise.race(promises);
            }

            // Small delay to prevent tight loop
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Wait for all remaining downloads to complete
        await Promise.all(promises);
    }

    // Stop all downloads and clear queue
    stop(): void {
        this.queue = [];
        this.processing = false;
    }
}

const downloadOrchestrator = DownloadOrchestrator.getInstance();
export default downloadOrchestrator;

