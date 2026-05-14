import { FlowOrchestrator } from '../../base/flow/flow-orchestrator';
import { FlowBase } from "../../base/flow/flow-base";
import { FlowSettings } from '../../base/flow/flow-settings';
import { globalLogger, Logger } from "../../base/logger/logger";
import { Task } from '../../base/task/task';
import { DownloadTask } from './utils/downloadTask';
import { taskIdFromUrl } from './utils/taskId';
import { ToolbarButtonHook } from '../../components/Toolbar/Toolbar';
import { ColumnDefinition } from '../../components/TaskListPanel/TaskListPanel';
import { ActionBarRow, ContextualActionBar, ContextualActions } from '../../types/actions';
import clipboard from 'clipboardy';
import open from 'open';
import { useExitButton } from './toolbar/useExitButton';
import { useRunAllButton } from './toolbar/useRunAllButton';
import { useSettingsButton } from './toolbar/useSettingsButton';
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
import { YtDlpService } from './services/download-providers/ytdlp/YtDlpService';
import { MetadataService } from './metadataService';
import { DownloadService } from './downloadService';
import { providerDisplayRegistry } from '../../base/providerDisplay';
import { ProviderConstructorLike } from '../../base/providerSettings';
import { SettingsStore } from '../../settings/settingsStore';
import {
    MusicDownloadFlowSettings,
    BASE_DEFAULT_MUSIC_DOWNLOAD_FLOW_SETTINGS,
    extractProviderDefaults,
} from './settings';
import { buildFlowSettingsItems, ProviderEntry } from './buildFlowSettingsItems';
import { DeepPartial } from '../../utils/types';
import { SettingsItem } from '../../settings/buildSettingsItems';


type Column = ColumnDefinition<MusicDownloadTaskAttributes>;

function toOpenableUri(url: string): string {
    const m = url.match(/open\.spotify\.com\/(track|album|artist|playlist)\/([A-Za-z0-9]+)/);
    if (m) return `spotify:${m[1]}:${m[2]}`;
    return url;
}

const GenericProviderCell: Column['component'] = () => null;

const DEFAULT_TEST_URL = "https://open.spotify.com/track/4v7kKFlEDmpVToHOICsXaM";

export class MusicDownloadFlow extends FlowBase<MusicDownloadTaskAttributes> {
    public readonly id = "music-downloader";
    public readonly displayName = "Music Downloader";
    public readonly author = "Tetraxel";
    protected tasks: DownloadTask[] = []
    protected maxConcurrentTasks = 2;
    protected displayMode: "metadata" | "download" = "metadata";
    protected metadataServiceRegistry = new ServiceRegistry<DownloadTask, MetadataService>();
    protected downloadServiceRegistry = new ServiceRegistry<DownloadTask, DownloadService>();
    protected settings = new FlowSettings<MusicDownloadFlowSettings>(
        'music-downloader',
        () => this.computeDefaultSettings(),
    );

    private static instance: MusicDownloadFlow;

    static getInstance(logger: Logger, defaultEnabled: boolean, orchestrator: FlowOrchestrator): MusicDownloadFlow {
        if (!MusicDownloadFlow.instance) {
            MusicDownloadFlow.instance = new MusicDownloadFlow(logger, defaultEnabled, orchestrator);
        }
        return MusicDownloadFlow.instance;
    }

    // ── Settings ────────────────────────────────────────────────────────────

    private computeDefaultSettings(): MusicDownloadFlowSettings {
        return {
            ...BASE_DEFAULT_MUSIC_DOWNLOAD_FLOW_SETTINGS,
            metadata: {
                ...BASE_DEFAULT_MUSIC_DOWNLOAD_FLOW_SETTINGS.metadata,
                providers: extractProviderDefaults(this.metadataServiceRegistry),
            },
            download: {
                ...BASE_DEFAULT_MUSIC_DOWNLOAD_FLOW_SETTINGS.download,
                providers: extractProviderDefaults(this.downloadServiceRegistry),
            },
        };
    }

    public getFlowSettings(): Record<string, unknown> {
        return this.settings.get() as Record<string, unknown>;
    }

    public getMusicDownloadFlowSettings(): MusicDownloadFlowSettings {
        return this.settings.get();
    }

    public buildFlowSettingsItems(
        flowSettings: Record<string, unknown>,
        onChange: (patch: Record<string, unknown>) => void,
    ): SettingsItem[] {
        const toEntries = (registry: ServiceRegistry<any, any>): ProviderEntry[] =>
            Array.from(registry.getFactories().keys())
                .map(key => ({ key, ctor: registry.getConstructor(key) as ProviderConstructorLike }));

        return buildFlowSettingsItems(
            flowSettings as MusicDownloadFlowSettings,
            toEntries(this.metadataServiceRegistry),
            toEntries(this.downloadServiceRegistry),
            onChange as (patch: DeepPartial<MusicDownloadFlowSettings>) => void,
        );
    }

    public saveFlowSettings(settings: Record<string, unknown>): void {
        this.settings.save(settings);
    }

    // ── Constructor ──────────────────────────────────────────────────────────

    public constructor(logger: Logger, defaultEnabled: boolean, orchestrator: FlowOrchestrator) {
        super(logger, defaultEnabled, orchestrator);

        globalLogger.debug("Initializing MusicDownloadFlow");

        // Register all available providers. Add new providers here.
        this.metadataServiceRegistry.register('spotify', SpotifyService);
        this.metadataServiceRegistry.register('youtube', YoutubeService);
        // this.metadataServiceRegistry.register('musicbrainz', MusicBrainzService);

        this.downloadServiceRegistry.register('ytdlp', YtDlpService);
        // this.downloadServiceRegistry.register('soulseek', SoulseekService);

        SettingsStore.getInstance().onSettingsChanged(() => this.notifyTaskSubscribers());

        const defaultTasks = this.createTasksFromUrls([DEFAULT_TEST_URL], { toTag: true, toDownload: true });
        this.orchestrator.addTasks(defaultTasks);
        this.logger.info(`Imported default test URL: ${DEFAULT_TEST_URL}`);
    }

    // ── FlowBase overrides ───────────────────────────────────────────────────

    public getDisplayMode(): "download" | "metadata" {
        return this.displayMode;
    }

    public setDisplayMode(mode: "download" | "metadata"): void {
        this.displayMode = mode;
        this.notifyTaskSubscribers();
    }

    public switchMode(input: string): void {
        if (input === "1") { this.setDisplayMode("metadata"); return; }
        if (input === "2") { this.setDisplayMode("download"); return; }
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
            isMetadataEnabled: key => this.settings.get().metadata.providers[key]?.enabled !== false,
            isDownloadEnabled: key => this.settings.get().download.providers[key]?.enabled !== false,
        }));
    }

    async restartTask(task: DownloadTask): Promise<void> {
        task.updateAttributes({ state: 'pending', metadataSources: [], metadataOverride: {}, downloadSources: [] });
        this.orchestrator.processTask(task);
    }

    async runAll(): Promise<void> { this.orchestrator.processTasks() }
    async stopAll(): Promise<void> { }

    public getToolbarButtons(): ToolbarButtonHook[] {
        return [
            useRunAllButton,
            useSettingsButton,
            useExitButton,
        ];
    }

    public getContextualActionBar(
        task: DownloadTask,
        attributes: { columnIndex: number; taskIndex: number; taskCount: number },
    ): ContextualActionBar {
        const columns = this.getColumns();
        const column = columns[attributes.columnIndex];
        const attrs = task.getAttributes();

        // ── Task row (bottom) ─────────────────────────────────────────────────
        const hasBeenRun = attrs?.state !== 'pending';
        const taskActions: ContextualActions[] = [
            {
                shortcuts: [{ input: "r" }],
                label: hasBeenRun ? "Restart" : "Start",
                description: hasBeenRun ? "Restart this task from scratch" : "Start this task",
                onClick: () => hasBeenRun ? task.restart() : task.start(),
            },
        ];
        if (attrs?.primaryMetadataFetched) {
            taskActions.push({
                shortcuts: [{ input: "f" }],
                label: "Re-fetch primary metadata",
                onClick: () => task.startPrimaryMetadataFetching(),
            });
        }
        if (attrs?.metadataDiscovered) {
            taskActions.push({
                shortcuts: [{ input: "d" }],
                label: "Re-discover metadata providers",
                onClick: () => task.startMetadataDiscovering(),
            });
        }
        if (attrs?.downloadsFetched) {
            taskActions.push({
                shortcuts: [{ input: "w" }],
                label: "Re-download all sources",
                onClick: () => task.startDownloads(),
            });
        }

        // ── Column row (top) ──────────────────────────────────────────────────
        const columnActions: ContextualActions[] = [];
        let columnLabel = column.label;
        let columnColor = column.color;

        if (column.id === "toTag") {
            columnActions.push({
                shortcuts: [{ key: "return" }],
                label: "Toggle tagging",
                multiSelectAllowed: true,
                onClick: () => task.updateAttributes({ toTag: !attrs?.toTag }),
                onClickBatch: (tasks) => {
                    const newValue = !attrs?.toTag;
                    tasks.forEach(t => t.updateAttributes({ toTag: newValue }));
                },
            });
        }

        if (column.id === "toDownload") {
            columnActions.push({
                shortcuts: [{ key: "return" }],
                label: "Toggle downloading",
                multiSelectAllowed: true,
                onClick: () => task.updateAttributes({ toDownload: !attrs?.toDownload }),
                onClickBatch: (tasks) => {
                    const newValue = !attrs?.toDownload;
                    tasks.forEach(t => t.updateAttributes({ toDownload: newValue }));
                },
            });
        }

        if (column.id === "url") {
            const url = attrs?.userInput.url ?? '';
            columnActions.push({
                shortcuts: [{ input: "c", ctrl: true }],
                label: "Copy source URL",
                onClick: () => clipboard.writeSync(url),
            });
        }

        if (column.id === "artist") {
            const primary = attrs?.metadataSources.find(s => s.isPrimarySource);
            columnActions.push({
                shortcuts: [{ input: "c", ctrl: true }],
                label: "Copy artist",
                onClick: () => clipboard.writeSync(primary?.metadata.artists[0]?.name ?? ''),
            });
        }

        if (column.id === "track") {
            const primary = attrs?.metadataSources.find(s => s.isPrimarySource);
            columnActions.push({
                shortcuts: [{ input: "c", ctrl: true }],
                label: "Copy track title",
                onClick: () => clipboard.writeSync(primary?.metadata.trackName ?? ''),
            });
        }

        if (column.id.startsWith("metadataService-")) {
            const serviceKey = column.id.replace("metadataService-", "");
            const display = providerDisplayRegistry.get(serviceKey);
            columnLabel = display.label;
            columnColor = display.color;
            const source = attrs?.metadataSources.find(
                s => s.metadata.platform === serviceKey || s.metadata.apiProvider === serviceKey
            );
            const url = source?.metadata.url ?? '';
            if (url) {
                columnActions.push({
                    shortcuts: [{ input: "c", ctrl: true }],
                    label: `Copy ${display.label} URL`,
                    onClick: () => clipboard.writeSync(url),
                });
                columnActions.push({
                    shortcuts: [{ key: "return" }],
                    label: `Open in ${display.label}`,
                    onClick: () => { open(toOpenableUri(url)).catch(() => { }); },
                });
            }
            columnActions.push({
                shortcuts: [{ input: "s" }],
                label: "Re-search",
                onClick: () => { task.startSingleProviderSearch(serviceKey); },
            });
        }

        return {
            rows: [
                { text: columnLabel, textColor: columnColor, actions: columnActions },
                { text: `Task ${attributes.taskIndex + 1}/${attributes.taskCount}`, actions: taskActions },
            ],
        };
    }

    //!\ Always return all columns to maintain consistent hook count !
    public getColumns(): Column[] {
        const checkboxColumns: Column[] = [
            { id: "toTag", label: "TAG?", weight: 1, flexGrow: 0, component: ToTagCell },
            { id: "toDownload", label: "DL?", weight: 1, flexGrow: 0, component: ToDownloadCell },
        ];
        const trackColumns: Column[] = [
            { id: "url", label: "URL", weight: this.displayMode === "metadata" ? 45 : 3, flexGrow: 0, component: UrlCell },
            { id: "artist", label: "ARTIST", weight: 16, flexGrow: 0, component: ArtistCell },
            { id: "track", label: "TRACK", weight: 30, flexGrow: 0, component: TrackCell },
        ];
        const statusColumns: Column[] = [
            { id: "status", label: "STATUS", weight: 28, minWidth: 20, flexGrow: 0, component: StatusCell },
        ];

        let columns: Column[] = [...checkboxColumns, ...trackColumns];

        if (this.displayMode === "metadata") {
            const { providers } = this.settings.get().metadata;
            const metadataServiceColumns: Column[] = Array.from(
                this.metadataServiceRegistry.getEnabledFactories(key => providers[key]?.enabled !== false).keys()
            ).map(key => {
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
            columns = columns.concat(metadataServiceColumns);
        }

        if (this.displayMode === "download") {
            const { providers } = this.settings.get().download;
            const downloadServiceColumns: Column[] = Array.from(
                this.downloadServiceRegistry.getEnabledFactories(key => providers[key]?.enabled !== false).keys()
            ).map(key => {
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
            columns = columns.concat(downloadServiceColumns);
        }

        return [...columns, ...statusColumns];
    }
}
