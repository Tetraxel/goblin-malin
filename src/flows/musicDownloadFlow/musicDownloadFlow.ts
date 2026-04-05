import fs from 'fs/promises';
import { FlowOrchestrator } from '../../base/flow/flow-orchestrator';
import { FlowBase } from "../../base/flow/flow-base";
import { Logger } from "../../base/logger/logger";
import { Task } from '../../base/task/task';
import { DownloadTask, DownloadTaskAttributes } from './utils/downloadTask';
import { InputLoader } from './utils/input-loader';
import { ToolbarButtonHook } from '../../components/Toolbar';
import { ColumnDefinition } from '../../components/TaskListPanel';
import { useExitButton } from './toolbar/useExitButton';
import { useRunAllButton } from './toolbar/useRunAllButton';
import { useImportButton } from './toolbar/useImportButton';
import { MbCell } from './columns/MbCell';
import { UrlCell } from './columns/UrlCell';
import { ArtistCell } from './columns/ArtistCell';
import { TrackCell } from './columns/TrackCell';
import { StatusCell } from './columns/StatusCell';


export class MusicDownloadFlow extends FlowBase<DownloadTaskAttributes> {
    public readonly id = "music-downloader";
    public readonly displayName = "Music Downloader";
    public readonly author = "Tetraxel";
    static inputLoader: InputLoader = InputLoader.getInstance()
    protected tasks: Task[] = []

    protected maxConcurrentTasks = 2; // Flow-specific limit

    private static instance: MusicDownloadFlow;

    static getInstance(logger: Logger, defaultEnabled: boolean, orchestrator: FlowOrchestrator): MusicDownloadFlow {
        if (!MusicDownloadFlow.instance) {
            MusicDownloadFlow.instance = new MusicDownloadFlow(logger, defaultEnabled, orchestrator);
        }
        return MusicDownloadFlow.instance;
    }

    async importTasks(): Promise<void> {
        const filePath = "inputs.txt"
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const lines = content
                .split('\n')
                .map(line => line.trim())
                // Filter empty lines and comments
                .filter(line => line.length > 0 && !line.startsWith('#'));

            const tasks: Task[] = lines.map(
                (url, index) => {
                    return new DownloadTask({
                        id: `item-${index}`,
                        initialInput: url,
                        attributes: {},
                        flowId: this.id,
                        logger: this.logger,
                    })
                }
            );
            this.orchestrator.addTasks(tasks)
            this.logger.info(`Loaded ${tasks.length} items from ${filePath}`);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                this.logger.error(`File not found: ${filePath}`);
                throw new Error(`Input file '${filePath}' does not exist`);
            }

            this.logger.error(`Failed to read ${filePath}`, { error });
            throw error;
        }
    }

    async restartTask(task: Task): Promise<void> {
        this.orchestrator.processTask(task)
    }

    async runAll(): Promise<void> {
        this.orchestrator.processTasks()
    }

    async stopAll(): Promise<void> {

    }

    getToolbarButtons(): ToolbarButtonHook[] {
        return [
            useImportButton,
            useRunAllButton,
            () => ({
                label: "Settings",
                icon: "⛭",
                color: "gray",
                enabled: true,
            }),
            useExitButton
        ];
    }

    getColumns(): ColumnDefinition<DownloadTaskAttributes>[] {
        return [
            {
                label: "URL",
                weight: 45,
                flexGrow: 0,
                component: UrlCell,
            },
            {
                label: "MB",
                weight: 11,
                flexGrow: 0,
                component: MbCell,
            },
            {
                label: "ARTIST",
                weight: 16,
                flexGrow: 0,
                component: ArtistCell,
            },
            {
                label: "TRACK",
                weight: 30,
                flexGrow: 0,
                component: TrackCell,
            },
            {
                label: "STATUS",
                weight: 28,
                minWidth: 20,
                flexGrow: 0,
                component: StatusCell,
            },
        ]
    }
}
