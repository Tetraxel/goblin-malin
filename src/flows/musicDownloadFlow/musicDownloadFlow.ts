import clipboard from "clipboardy";
import open from "open";
import { FlowOrchestrator } from "#base/flow/flow-orchestrator";
import { FlowBase } from "#base/flow/flow-base";
import { startOptionsBridge } from "#base/flow/startOptionsBridge";
import { FlowSettings } from "#base/flow/flow-settings";
import { globalLogger, Logger } from "#base/logger/logger";
import { ServiceRegistry } from "#base/service-registry";
import { providerDisplayRegistry } from "#base/providerDisplay";
import { ProviderConstructorLike } from "#base/providerSettings";
import { SettingsStore } from "#settings/settingsStore";
import { DeepPartial } from "#utils/types";
import { SettingsItem } from "#settings/buildSettingsItems";
import { ToolbarButtonHook } from "#components/Toolbar/Toolbar";
import { ColumnDefinition } from "#components/TaskListPanel/TaskListPanel";
import { ContextualActionBar, ContextualActions } from "#types/actions";
import { runWithoutCache } from "#utils/cache";
import { useExitButton } from "../../components/Toolbar/useExitButton";
import { useRunAllButton } from "./toolbar/useRunAllButton";
import { useSettingsButton } from "../../components/Toolbar/useSettingsButton";
import { UrlCell } from "./columns/UrlCell";
import { ArtistCell } from "./columns/ArtistCell";
import { TrackCell } from "./columns/TrackCell";
import { StatusCell } from "./columns/StatusCell";
import { ToTagCell } from "./columns/ToTagCell";
import { ToDownloadCell } from "./columns/ToDownloadCell";
import { MetadataService } from "./metadataService";
import { DiscoveryMetadataService } from "./discoveryMetadataService";
import { DownloadService } from "./downloadService";
import { SpotifyService } from "./services/metadata-providers/spotify/SpotifyService";
import { YoutubeService } from "./services/metadata-providers/youtube/YoutubeService";
import { SonglinkService } from "./services/metadata-providers/songlink/SonglinkService";
import { MusicBrainzDiscoveryService } from "./services/metadata-providers/musicbrainz/MusicBrainzDiscoveryService";
import { YtDlpService } from "./services/download-providers/ytdlp/YtDlpService";
import { DownloadTask } from "./utils/downloadTask";
import { taskIdFromUrl } from "./utils/taskId";
import { MusicDownloadTaskAttributes } from "./types";
import {
    MusicDownloadFlowSettings,
    BASE_DEFAULT_MUSIC_DOWNLOAD_FLOW_SETTINGS,
    extractProviderDefaults,
} from "./settings";
import { buildFlowSettingsItems, ProviderEntry } from "./buildFlowSettingsItems";

type Column = ColumnDefinition<MusicDownloadTaskAttributes>;

// Suppress the re-throw from @SafeAction — logging is already handled by the decorator.
const fire = (p: Promise<void>): void => {
    p.catch(() => {});
};

function toOpenableUri(url: string): string {
    const m = url.match(/open\.spotify\.com\/(track|album|artist|playlist)\/([A-Za-z0-9]+)/);
    if (m) return `spotify:${m[1]}:${m[2]}`;
    return url;
}

const GenericProviderCell: Column["component"] = () => null;

const DEFAULT_TEST_URL = "https://open.spotify.com/track/4v7kKFlEDmpVToHOICsXaM";

export class MusicDownloadFlow extends FlowBase<MusicDownloadTaskAttributes> {
    public readonly id = "music-downloader";
    public readonly displayName = "Music Downloader";
    public readonly author = "Tetraxel";
    protected tasks: DownloadTask[] = [];
    protected maxConcurrentTasks = 2;
    protected displayMode: "metadata" | "download" = "metadata";
    protected metadataServiceRegistry = new ServiceRegistry<DownloadTask, MetadataService>();
    protected discoveryServiceRegistry = new ServiceRegistry<DownloadTask, DiscoveryMetadataService>();
    protected downloadServiceRegistry = new ServiceRegistry<DownloadTask, DownloadService>();
    protected settings = new FlowSettings<MusicDownloadFlowSettings>("music-downloader", () =>
        this.computeDefaultSettings()
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
                discoveryProviders: extractProviderDefaults(this.discoveryServiceRegistry),
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
        onOpenWizard?: (config: import("../../base/setupWizard").SetupWizardConfig, onDisable?: () => void) => void
    ): SettingsItem[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const toEntries = (registry: ServiceRegistry<any, any>): ProviderEntry[] =>
            Array.from(registry.getAllConstructors().keys()).map((key) => ({
                key,
                ctor: registry.getConstructor(key) as ProviderConstructorLike,
            }));

        return buildFlowSettingsItems(
            flowSettings as MusicDownloadFlowSettings,
            toEntries(this.metadataServiceRegistry),
            toEntries(this.downloadServiceRegistry),
            toEntries(this.discoveryServiceRegistry),
            onChange as (patch: DeepPartial<MusicDownloadFlowSettings>) => void,
            onOpenWizard
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
        this.metadataServiceRegistry.register("spotify", SpotifyService);
        this.metadataServiceRegistry.register("youtube", YoutubeService);
        // this.metadataServiceRegistry.register('musicbrainz', MusicBrainzService);

        this.discoveryServiceRegistry.register("songlink", SonglinkService);
        this.discoveryServiceRegistry.register("musicBrainz", MusicBrainzDiscoveryService);

        this.downloadServiceRegistry.register("ytdlp", YtDlpService);
        // this.downloadServiceRegistry.register('soulseek', SoulseekService);

        SettingsStore.getInstance().onSettingsChanged(() => this.notifyTaskSubscribers());

        // const defaultTasks = this.createTasksFromUrls([DEFAULT_TEST_URL], { toTag: true, toDownload: true });
        // this.orchestrator.addTasks(defaultTasks);
        // this.logger.info(`Imported default test URL: ${DEFAULT_TEST_URL}`);
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
        if (input === "1") {
            this.setDisplayMode("metadata");
            return;
        }
        if (input === "2") {
            this.setDisplayMode("download");
            return;
        }
    }

    public createTasksFromUrls(urls: string[], opts: { toTag?: boolean; toDownload?: boolean } = {}): DownloadTask[] {
        const { toTag = true, toDownload = false } = opts;
        return urls.map(
            (url) =>
                new DownloadTask({
                    id: taskIdFromUrl(url),
                    initialInput: url,
                    attributes: {
                        state: "pending",
                        userInput: { type: "url", url },
                        metadataGroups: [],
                        metadataOverride: {},
                        downloadSources: [],
                        toTag,
                        toDownload,
                    },
                    flowId: this.id,
                    logger: this.logger,
                    metadataServiceRegistry: this.metadataServiceRegistry,
                    discoveryServiceRegistry: this.discoveryServiceRegistry,
                    downloadServiceRegistry: this.downloadServiceRegistry,
                    isMetadataServiceEnabled: (key) => this.settings.get().metadata.providers[key]?.enabled !== false,
                    isDiscoveryServiceEnabled: (key) =>
                        this.settings.get().metadata.discoveryProviders[key]?.enabled !== false,
                    isDownloadServiceEnabled: (key) => this.settings.get().download.providers[key]?.enabled !== false,
                })
        );
    }

    async restartTask(task: DownloadTask): Promise<void> {
        task.updateAttributes({ state: "pending", metadataGroups: [], metadataOverride: {}, downloadSources: [] });
        this.orchestrator.processTask(task);
    }

    async runAll(): Promise<void> {
        this.orchestrator.processTasks();
    }
    async stopAll(): Promise<void> {}

    public getToolbarButtons(): ToolbarButtonHook[] {
        return [useRunAllButton];
    }

    public getContextualActionBar(
        task: DownloadTask,
        attributes: { columnIndex: number; taskIndex: number; taskCount: number }
    ): ContextualActionBar {
        const columns = this.getColumns();
        const column = columns[attributes.columnIndex];
        const attrs = task.getAttributes();

        // ── Task row (bottom) ─────────────────────────────────────────────────
        const hasBeenRun = attrs?.state !== "pending";
        // Already-run tasks restart without cache; pending tasks start normally.
        const runTask = (t: DownloadTask) =>
            t.getAttributes()?.state !== "pending" ? fire(runWithoutCache(() => t.restart())) : fire(t.start());
        const needsOptions = (t: DownloadTask) => {
            const a = t.getAttributes();
            return !a?.toTag && !a?.toDownload;
        };
        const taskActions: ContextualActions[] = [
            {
                shortcuts: [{ input: "r" }],
                label: hasBeenRun ? "Restart" : "Start",
                description: hasBeenRun ? "Restart this task from scratch" : "Start this task",
                multiSelectAllowed: true,
                onClick: () => {
                    if (needsOptions(task)) {
                        startOptionsBridge.request({
                            taskCount: 1,
                            apply: (opts) => {
                                task.updateAttributes(opts);
                                runTask(task);
                            },
                        });
                    } else {
                        runTask(task);
                    }
                },
                onClickBatch: (tasks) => {
                    const selected = tasks as DownloadTask[];
                    const needing = selected.filter(needsOptions);
                    if (needing.length > 0) {
                        startOptionsBridge.request({
                            taskCount: selected.length,
                            apply: (opts) => {
                                needing.forEach((t) => t.updateAttributes(opts));
                                selected.forEach(runTask);
                            },
                        });
                    } else {
                        selected.forEach(runTask);
                    }
                },
            },
        ];
        if (attrs?.primaryMetadataFetched) {
            taskActions.push({
                shortcuts: [{ input: "f" }],
                label: "Re-fetch primary metadata",
                onClick: () => fire(runWithoutCache(() => task.startPrimaryMetadataFetching())),
            });
        }
        if (attrs?.metadataDiscovered) {
            taskActions.push({
                shortcuts: [{ input: "d" }],
                label: "Re-discover metadata providers",
                onClick: () => fire(task.startMetadataDiscovering()),
            });
        }
        if (attrs?.downloadsFetched) {
            taskActions.push({
                shortcuts: [{ input: "w" }],
                label: "Re-download all sources",
                onClick: () => fire(task.startDownloads()),
            });
        } else if (attrs?.metadataDiscovered) {
            taskActions.push({
                shortcuts: [{ input: "w" }],
                label: "Download sources",
                onClick: () => {
                    task.updateAttributes({ toDownload: true });
                    fire(task.startDownloads());
                },
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
                    tasks.forEach((t) => t.updateAttributes({ toTag: newValue }));
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
                    tasks.forEach((t) => t.updateAttributes({ toDownload: newValue }));
                },
            });
        }

        if (column.id === "url") {
            const url = attrs?.userInput.url ?? "";
            columnActions.push({
                shortcuts: [{ input: "c", ctrl: true }],
                label: "Copy source URL",
                onClick: () => clipboard.writeSync(url),
            });
        }

        if (column.id === "artist") {
            const primary = attrs?.metadataGroups.flatMap((g) => g.results).find((r) => r.isPrimaryInput);
            columnActions.push({
                shortcuts: [{ input: "c", ctrl: true }],
                label: "Copy artist",
                onClick: () => clipboard.writeSync(primary?.metadata.artists[0]?.name ?? ""),
            });
        }

        if (column.id === "track") {
            const primary = attrs?.metadataGroups.flatMap((g) => g.results).find((r) => r.isPrimaryInput);
            columnActions.push({
                shortcuts: [{ input: "c", ctrl: true }],
                label: "Copy track title",
                onClick: () => clipboard.writeSync(primary?.metadata.trackName ?? ""),
            });
        }

        if (column.id.startsWith("metadataService-")) {
            const serviceKey = column.id.replace("metadataService-", "");
            const display = providerDisplayRegistry.get(serviceKey);
            columnLabel = display.label;
            columnColor = display.color;
            const group = attrs?.metadataGroups.find((g) => g.serviceKey === serviceKey);
            const source = group?.results.find((r) => !r.isRejected) ?? group?.results[0];
            const url = source?.metadata.url ?? "";
            if (url) {
                columnActions.push({
                    shortcuts: [{ input: "c", ctrl: true }],
                    label: `Copy ${display.label} URL`,
                    onClick: () => clipboard.writeSync(url),
                });
                columnActions.push({
                    shortcuts: [{ key: "return" }],
                    label: `Open in ${display.label}`,
                    onClick: () => {
                        open(toOpenableUri(url)).catch(() => {});
                    },
                });
            }
            columnActions.push({
                shortcuts: [{ input: "s" }],
                label: "Re-search",
                onClick: () => fire(task.startSingleProviderSearch(serviceKey)),
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
            { id: "toTag", label: "TAG?", weight: 0, flexGrow: 0, resizable: false, component: ToTagCell },
            { id: "toDownload", label: "DL?", weight: 0, flexGrow: 0, resizable: false, component: ToDownloadCell },
        ];
        const trackColumns: Column[] = [
            {
                id: "url",
                label: "URL",
                weight: this.displayMode === "metadata" ? 45 : 3,
                flexGrow: 0,
                component: UrlCell,
            },
            { id: "artist", label: "ARTIST", weight: 16, flexGrow: 0, component: ArtistCell },
            { id: "track", label: "TRACK", weight: 30, flexGrow: 0, component: TrackCell },
        ];
        const statusColumns: Column[] = [
            { id: "status", label: "STATUS", weight: 28, flexGrow: 0, component: StatusCell },
        ];

        let columns: Column[] = [...checkboxColumns, ...trackColumns];

        if (this.displayMode === "metadata") {
            const { providers } = this.settings.get().metadata;
            const metadataServiceColumns: Column[] = Array.from(
                this.metadataServiceRegistry.getEnabledFactories((key) => providers[key]?.enabled !== false).keys()
            ).map((key) => {
                const display = providerDisplayRegistry.get(key);
                return {
                    id: `metadataService-${key}`,
                    label: display.acronym,
                    color: display.color,
                    weight: 20,
                    flexGrow: 0,
                    component:
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        (this.metadataServiceRegistry.getConstructor(key) as any)?.cellComponent ?? GenericProviderCell,
                };
            });
            columns = columns.concat(metadataServiceColumns);
        }

        if (this.displayMode === "download") {
            const { providers } = this.settings.get().download;
            const downloadServiceColumns: Column[] = Array.from(
                this.downloadServiceRegistry.getEnabledFactories((key) => providers[key]?.enabled !== false).keys()
            ).map((key) => {
                const display = providerDisplayRegistry.get(key);
                return {
                    id: `downloadService-${key}`,
                    label: display.acronym,
                    color: display.color,
                    weight: 32,
                    flexGrow: 0,
                    component:
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        (this.downloadServiceRegistry.getConstructor(key) as any)?.cellComponent ?? GenericProviderCell,
                };
            });
            columns = columns.concat(downloadServiceColumns);
        }

        const allColumns = [...columns, ...statusColumns];
        const storedRatios = this.settings.get().ui.columnRatios;
        return allColumns.map((col) =>
            storedRatios[col.id] !== undefined ? { ...col, widthRatio: storedRatios[col.id] } : col
        );
    }

    public override setColumnRatios(ratios: Record<string, number>): void {
        const current = this.settings.get();
        this.settings.save({ ...current, ui: { ...current.ui, columnRatios: ratios } });
        this.notifyTaskSubscribers();
    }
}
