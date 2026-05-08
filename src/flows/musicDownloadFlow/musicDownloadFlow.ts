import { FlowOrchestrator } from '../../base/flow/flow-orchestrator';
import { FlowBase } from "../../base/flow/flow-base";
import { globalLogger, Logger } from "../../base/logger/logger";
import { Task } from '../../base/task/task';
import { DownloadTask } from './utils/downloadTask';
import { taskIdFromUrl } from './utils/taskId';
import { ToolbarButtonHook } from '../../components/Toolbar';
import { ColumnDefinition } from '../../components/TaskListPanel';
import { ContextualActionBar, ContextualActions } from '../../types/actions';
import { useExitButton } from './toolbar/useExitButton';
import { useRunAllButton } from './toolbar/useRunAllButton';
import { useImportButton } from './toolbar/useImportButton';
import { UrlCell } from './columns/UrlCell';
import { ArtistCell } from './columns/ArtistCell';
import { TrackCell } from './columns/TrackCell';
import { StatusCell } from './columns/StatusCell';
import { ToTagCell } from './columns/ToTagCell';
import { ToDownloadCell } from './columns/ToDownloadCell';
import { MusicDownloadTaskAttributes } from './types';
import { ServiceRegistry } from '../../base/service-registry';
import { SpotifyService } from './services/metadata-providers/spotify/SpotifyService';
import { YoutubeService } from './services/metadata-providers/youtube/YoutubeService';
import { SoulseekService } from './services/download-providers/soulseek/SoulseekService';
import { YtDlpService } from './services/download-providers/ytdlp/YtDlpService';
import { MetadataService } from './metadataService';
import { DownloadService } from './downloadService';
import { providerDisplayRegistry } from '../../base/providerDisplay';


type Column = ColumnDefinition<MusicDownloadTaskAttributes> & {

}

const GenericProviderCell: Column['component'] = () => null;

const DEFAULT_TEST_URL = "https://open.spotify.com/track/4v7kKFlEDmpVToHOICsXaM";

export class MusicDownloadFlow extends FlowBase<MusicDownloadTaskAttributes> {
    public readonly id = "music-downloader";
    public readonly displayName = "Music Downloader";
    public readonly author = "Tetraxel";
    protected tasks: DownloadTask[] = []
    protected maxConcurrentTasks = 2; // Flow-specific limit
    protected displayMode: "metadata" | "download" = "metadata";
    protected metadataServiceRegistry: ServiceRegistry<DownloadTask, MetadataService>;
    protected downloadServiceRegistry: ServiceRegistry<DownloadTask, DownloadService>;

    private static instance: MusicDownloadFlow;

    static getInstance(logger: Logger, defaultEnabled: boolean, orchestrator: FlowOrchestrator): MusicDownloadFlow {
        if (!MusicDownloadFlow.instance) {
            MusicDownloadFlow.instance = new MusicDownloadFlow(logger, defaultEnabled, orchestrator);
        }
        return MusicDownloadFlow.instance;
    }

    public constructor(logger: Logger, defaultEnabled: boolean, orchestrator: FlowOrchestrator) {
        super(logger, defaultEnabled, orchestrator);

        globalLogger.debug("Initializing MusicDownloadFlow");

        this.metadataServiceRegistry = new ServiceRegistry<DownloadTask, MetadataService>()
            // .register('songlink', SonglinkService)
            // .register('musicbrainz', MusicBrainzService)
            .register('spotify', SpotifyService)
            .register('youtube', YoutubeService);

        this.downloadServiceRegistry = new ServiceRegistry<DownloadTask, DownloadService>()
            // .register('soulseek', SoulseekService)
            .register('ytdlp', YtDlpService);

        // Temporary url by default
        const defaultTasks = this.createTasksFromUrls([DEFAULT_TEST_URL], { toTag: true, toDownload: true });
        this.orchestrator.addTasks(defaultTasks);
        this.logger.info(`Imported default test URL: ${DEFAULT_TEST_URL}`);
    }

    public getDisplayMode(): "download" | "metadata" {
        return this.displayMode;
    }

    public setDisplayMode(mode: "download" | "metadata"): void {
        this.displayMode = mode;
        this.notifyTaskSubscribers();
    }

    public switchMode(input: string): void {
        if (input === "1") {
            this.setDisplayMode("metadata");
            return;
        }

        if (input === "2") {
            this.setDisplayMode("download");
            return;
        }
    }

    public createTasksFromUrls(
        urls: string[],
        opts: { toTag?: boolean; toDownload?: boolean } = {},
    ): DownloadTask[] {
        const { toTag = true, toDownload = false } = opts;
        return urls.map((url) => new DownloadTask({
            id: taskIdFromUrl(url),
            initialInput: url,
            attributes: {
                state: 'pending',
                userInput: { type: 'url', url },
                metadataSources: [],
                metadataOverride: {},
                downloadSources: [],
                toTag,
                toDownload,
            },
            flowId: this.id,
            logger: this.logger,
            metadataServiceRegistry: this.metadataServiceRegistry,
            downloadServiceRegistry: this.downloadServiceRegistry,
        }));
    }

    async restartTask(task: DownloadTask): Promise<void> {
        task.updateAttributes({ state: 'pending', metadataSources: [], metadataOverride: {}, downloadSources: [] });
        this.orchestrator.processTask(task);
    }

    async runAll(): Promise<void> {
        this.orchestrator.processTasks()
    }

    async stopAll(): Promise<void> {

    }

    public getToolbarButtons(): ToolbarButtonHook[] {
        return [
            // useImportButton,
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

    public getContextualActionBar(task: DownloadTask, attributes: { columnIndex: number }): ContextualActionBar {
        const columns = this.getColumns()
        const column = columns[attributes.columnIndex]
        let actionBartext = ""
        let actions: ContextualActions[] = []

        // TODO: show those shortcuts in another place to avoid confusion with the column-specific shortcuts
        actionBartext = "Task Actions"
        actions = actions.concat(
            [
                {
                    shortcuts: [{ input: "r" }],
                    label: "Start",
                    description: "Start this task",
                    onClick: () => task.start(),
                },
                // {
                //     shortcuts: [{ key: "backspace" }],
                //     label: "Stop",
                //     description: "Stop this task",
                //     color: "red",
                //     onClick: () => task.stop(),
                // }
            ]
        )

        if (column.id === "toTag") {
            actions = actions.concat([{
                shortcuts: [{ key: "return" }],
                label: "Toggle",
                description: "Toggle this option",
                multiSelectAllowed: true,
                onClick: () => task.updateAttributes({ toTag: !task.getAttributes()?.toTag }),
                onClickBatch: (tasks) => {
                    const newValue = !task.getAttributes()?.toTag;
                    tasks.forEach(task => task.updateAttributes({ toTag: newValue }));
                },
            }])
        }

        if (column.id === "toDownload") {
            actions = actions.concat([{
                shortcuts: [{ key: "return" }],
                label: "Toggle",
                description: "Toggle this option",
                multiSelectAllowed: true,
                onClick: () => task.updateAttributes({ toDownload: !task.getAttributes()?.toDownload }),
                onClickBatch: (tasks) => {
                    const newValue = !task.getAttributes()?.toDownload;
                    tasks.forEach(task => task.updateAttributes({ toDownload: newValue }));
                },
            }])
        }

        // if (this.displayMode === "metadata" && (column.id === "url" || column.id === "artist" || column.id === "track")) {
        //     actions = actions.concat([{
        //         shortcuts: [{ key: "ctrl", input: "C" }],
        //         label: `Copy ${column.id}`,
        //         description: "Copy the value from this column",
        //         onClick: () => task.getAttributes()?.metadataSources,
        //     }])
        // }

        if (column.id.startsWith("metadataService-")) {
            const serviceKey = column.id.replace("metadataService-", "")
            actionBartext = `${serviceKey}`
            actions = actions.concat([{
                shortcuts: [{ input: "s" }],
                label: "Search",
                description: "Search for metadata matching this track on this service",
                onClick: () => { task.startSingleProviderSearch(serviceKey); },
            }])
        }

        return {
            text: actionBartext,
            actions,
        }
    }

    //!\ Always return all columns to maintain consistent hook count !
    public getColumns(): Column[] {
        const checkboxColumns = [
            {
                id: "toTag",
                label: "TAG?",
                weight: 1,
                flexGrow: 0,
                component: ToTagCell,
            },
            {
                id: "toDownload",
                label: "DL?",
                weight: 1,
                flexGrow: 0,
                component: ToDownloadCell,
            },]
        const trackColumns = [
            {
                id: "url",
                label: "URL",
                weight: this.displayMode === "metadata" ? 45 : 3,
                flexGrow: 0,
                component: UrlCell,
            },
            {
                id: "artist",
                label: "ARTIST",
                weight: 16,
                flexGrow: 0,
                component: ArtistCell,
            },
            {
                id: "track",
                label: "TRACK",
                weight: 30,
                flexGrow: 0,
                component: TrackCell,
            }
        ]
        const statusColumns = [{
            id: "status",
            label: "STATUS",
            weight: 28,
            minWidth: 20,
            flexGrow: 0,
            component: StatusCell,
        }]

        let columns: Column[] = []

        columns = columns.concat(checkboxColumns)
        columns = columns.concat(trackColumns);

        if (this.displayMode === "metadata") {
            const metadataServiceColumns: Column[] = Array.from(this.metadataServiceRegistry.getFactories().keys()).map((key) => {
                const display = providerDisplayRegistry.get(key);
                return {
                    id: `metadataService-${key}`,
                    label: display.acronym,
                    color: display.color,
                    weight: 20,
                    flexGrow: 0,
                    component: (this.metadataServiceRegistry.getConstructor(key) as any)?.cellComponent ?? GenericProviderCell,
                };
            });
            globalLogger.debug(`Metadata service columns ${metadataServiceColumns.length}`)
            columns = columns.concat(metadataServiceColumns)
        }

        if (this.displayMode === "download") {
            const downloadServiceColumns: Column[] = Array.from(this.downloadServiceRegistry.getFactories().keys()).map((key) => {
                const display = providerDisplayRegistry.get(key);
                return {
                    id: `downloadService-${key}`,
                    label: display.acronym,
                    color: display.color,
                    weight: 32,
                    flexGrow: 0,
                    component: (this.downloadServiceRegistry.getConstructor(key) as any)?.cellComponent ?? GenericProviderCell,
                };
            });
            columns = columns.concat(downloadServiceColumns)
        }

        columns = columns.concat(statusColumns);

        return columns;
    }
}
