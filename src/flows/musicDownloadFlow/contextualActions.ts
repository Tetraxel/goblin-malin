import clipboard from "clipboardy";
import open from "open";
import { TaskOrchestrator } from "#base/task/orchestrator";
import { providerDisplayRegistry } from "#base/providerDisplay";
import { ContextualActionBar, ContextualActions } from "#types/actions";
import { ColumnDefinition } from "#components/TaskListPanel/TaskListPanel";
import { runWithoutCache } from "#utils/cache";
import { startOptionsBridge } from "#base/bridges/startOptionsBridge";
import { deleteConfirmBridge } from "#base/bridges/deleteConfirmBridge";
import { DownloadTask } from "./utils/downloadTask";
import { CollectionTask } from "./utils/collectionTask";
import { runSelected } from "./runController";
import { metadataLimiter, downloadLimiter } from "./utils/stageLimiters";
import type { Task } from "#base/task/task";
import type { Semaphore } from "#utils/semaphore";
import { globalLogger } from "#base/logger/logger";
import { SessionManager } from "#sessions/sessionManager";
import { MusicDownloadTaskAttributes, TrackDownloadTask, CollectionDownloadTask } from "./types";

// Suppress the re-throw from @SafeAction — logging is already handled by the decorator.
const fire = (p: Promise<unknown>): void => {
    p.catch(() => {});
};

type BarAttributes = {
    columns: ColumnDefinition<MusicDownloadTaskAttributes>[];
    columnIndex: number;
    taskIndex?: number;
    taskCount?: number;
    selectedCount?: number;
    /** The multi-selected tasks (only when more than one is selected) — batch actions run on these. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    selectedTasks?: Task<any>[];
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isTrackTask = (t: Task<any>): t is DownloadTask =>
    (t.getAttributes() as MusicDownloadTaskAttributes | undefined)?.kind === "track";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isCollectionTask = (t: Task<any>): t is CollectionTask =>
    (t.getAttributes() as MusicDownloadTaskAttributes | undefined)?.kind === "collection";

/**
 * Runs `run` on every eligible track of a batch, through the stage's shared limiter so a
 * 30-track selection doesn't fan out into 30 simultaneous API calls / downloads.
 */
function runBatch(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tasks: Task<any>[],
    limiter: Semaphore,
    eligible: (t: DownloadTask) => boolean,
    run: (t: DownloadTask) => Promise<unknown>
): void {
    for (const t of tasks.filter(isTrackTask)) {
        if (eligible(t)) fire(limiter.run(() => run(t)));
    }
}

/** One value per line, nothing else — empty values are skipped. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function copyLines(tasks: Task<any>[], valueOf: (t: DownloadTask) => string): void {
    clipboard.writeSync(
        tasks
            .filter(isTrackTask)
            .map(valueOf)
            .filter((v) => v !== "")
            .join("\n")
    );
}

function copyAction(label: string, task: DownloadTask, valueOf: (t: DownloadTask) => string): ContextualActions {
    return {
        shortcuts: [{ input: "c", ctrl: true }],
        label,
        multiSelectAllowed: true,
        onClick: () => clipboard.writeSync(valueOf(task)),
        onClickBatch: (tasks) => copyLines(tasks, valueOf),
    };
}

const primaryResultOf = (t: DownloadTask) =>
    t
        .getAttributes()
        ?.metadataGroups.flatMap((g) => g.results)
        .find((r) => r.isPrimaryInput);

/** Registry key of the service that provided (or would recognize) the task's source URL. */
function primaryServiceKeyOf(t: DownloadTask): string | undefined {
    const attrs = t.getAttributes();
    const primaryGroup = attrs?.metadataGroups.find((g) =>
        g.results.some((r) => r.isPrimaryInput && (r.metadata.url || r.metadata.uri))
    );
    return primaryGroup?.serviceKey ?? attrs?.recognizedServiceKey;
}

function sourceUrlFor(t: DownloadTask, serviceKey: string | undefined): string {
    const group = t.getAttributes()?.metadataGroups.find((g) => g.serviceKey === serviceKey);
    const source = group?.results.find((r) => !r.isRejected) ?? group?.results[0];
    return source?.metadata.url ?? "";
}

/** Move tasks to the archive (reversible, so no confirmation); running tasks are skipped. */
function archive(ids: string[]): void {
    const count = SessionManager.getInstance().archiveTasks(ids);
    if (count > 0) globalLogger.info(`Archived ${count} task${count === 1 ? "" : "s"}`);
}

function toOpenableUri(url: string): string {
    const m = url.match(/open\.spotify\.com\/(track|album|artist|playlist)\/([A-Za-z0-9]+)/);
    if (m) return `spotify:${m[1]}:${m[2]}`;
    return url;
}

/**
 * Build the two-row contextual action bar (column actions + task actions) for
 * the selected task/column. Callers pass the columns they currently render so
 * there is exactly one column source (App's memo). Dispatches on task kind —
 * album/playlist parent tasks get a different action set (start/restart/refetch/
 * collapse/live) than track tasks.
 */
export function buildContextualActionBar(
    task: DownloadTask | CollectionTask,
    attributes: BarAttributes
): ContextualActionBar {
    if (task.getAttributes()?.kind === "collection") {
        return buildCollectionContextualActionBar(task as CollectionTask, attributes);
    }
    return buildTrackContextualActionBar(task as DownloadTask, attributes);
}

function buildTrackContextualActionBar(task: DownloadTask, attributes: BarAttributes): ContextualActionBar {
    const orchestrator = TaskOrchestrator.getInstance();
    const column = attributes.columns[attributes.columnIndex];
    const attrs = task.getAttributes();
    // The tracks the actions below apply to: the whole multi-selection, or just this task.
    const group: DownloadTask[] = attributes.selectedTasks ? attributes.selectedTasks.filter(isTrackTask) : [task];
    const attrsOf = (t: DownloadTask) => t.getAttributes();

    // ── Task row (bottom) ─────────────────────────────────────────────────
    const state = attrs?.state;
    // Stopped and pending tasks start fresh; anything else is a restart.
    const hasBeenRun = state !== "pending" && state !== "stopped";
    // Already-run tasks restart without cache; pending/stopped tasks start normally.
    const runTask = (t: DownloadTask) =>
        t.getAttributes()?.state !== "pending" && t.getAttributes()?.state !== "stopped"
            ? fire(runWithoutCache(() => t.restart()))
            : fire(t.start());
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
                const doRun = (selectedTasks: DownloadTask[]) => {
                    runSelected(new Set(selectedTasks.map((t) => t.getId())));
                };
                if (needing.length > 0) {
                    startOptionsBridge.request({
                        taskCount: selected.length,
                        apply: (opts) => {
                            needing.forEach((t) => t.updateAttributes(opts));
                            doRun(selected);
                        },
                    });
                } else {
                    doRun(selected);
                }
            },
        },
    ];
    taskActions.push({
        shortcuts: [{ key: "delete" }],
        label: "Archive / Delete",
        description: "Archive this task, or remove it from the list for good",
        multiSelectAllowed: true,
        onClick: () =>
            deleteConfirmBridge.request({
                taskCount: 1,
                apply: () => orchestrator.removeTasks([task.getId()]),
                archive: () => archive([task.getId()]),
            }),
        onClickBatch: (tasks) =>
            deleteConfirmBridge.request({
                taskCount: tasks.length,
                apply: () => orchestrator.removeTasks(tasks.map((t) => t.getId())),
                archive: () => archive(tasks.map((t) => t.getId())),
            }),
    });
    if (group.some((t) => attrsOf(t)?.primaryMetadataFetched)) {
        const refetch = (t: DownloadTask) => runWithoutCache(() => t.startPrimaryMetadataFetching());
        taskActions.push({
            shortcuts: [{ input: "f" }],
            label: "Re-fetch primary metadata",
            multiSelectAllowed: true,
            onClick: () => fire(refetch(task)),
            onClickBatch: (tasks) =>
                runBatch(tasks, metadataLimiter, (t) => Boolean(attrsOf(t)?.primaryMetadataFetched), refetch),
        });
    }
    if (group.some((t) => attrsOf(t)?.metadataDiscovered)) {
        taskActions.push({
            shortcuts: [{ input: "d" }],
            label: "Re-discover metadata providers",
            multiSelectAllowed: true,
            onClick: () => fire(task.startMetadataDiscovering()),
            onClickBatch: (tasks) =>
                runBatch(
                    tasks,
                    metadataLimiter,
                    (t) => Boolean(attrsOf(t)?.metadataDiscovered),
                    (t) => t.startMetadataDiscovering()
                ),
        });
    }
    const downloadable = (t: DownloadTask) => Boolean(attrsOf(t)?.downloadsFetched || attrsOf(t)?.metadataDiscovered);
    const eligibleDownloads = group.filter(downloadable);
    if (eligibleDownloads.length > 0) {
        const download = (t: DownloadTask) => {
            if (!attrsOf(t)?.downloadsFetched) t.updateAttributes({ toDownload: true });
            return t.startDownloads();
        };
        taskActions.push({
            shortcuts: [{ input: "w" }],
            label: eligibleDownloads.every((t) => attrsOf(t)?.downloadsFetched)
                ? "Re-download all sources"
                : "Download sources",
            multiSelectAllowed: true,
            onClick: () => fire(download(task)),
            onClickBatch: (tasks) => runBatch(tasks, downloadLimiter, downloadable, download),
        });
    }

    // ── Column row (top) ──────────────────────────────────────────────────
    // `column` can be undefined when the selected column index is stale — e.g.
    // right after switching Metadata→Download view, the new (shorter) column set
    // doesn't have that index yet. Degrade to an empty column row in that case.
    const columnActions: ContextualActions[] = [];
    let columnLabel = column?.label ?? "";
    let columnColor = column?.color;

    if (column?.id === "toTag") {
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

    if (column?.id === "toDownload") {
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

    if (column?.id === "url") {
        const serviceKey = primaryServiceKeyOf(task);
        const urlOf = (t: DownloadTask) => sourceUrlFor(t, primaryServiceKeyOf(t)) || attrsOf(t)?.userInput.url || "";
        if (serviceKey) {
            columnActions.push(
                ...buildMetadataServiceColumnActions(serviceKey, task, { urlOf, serviceKeyOf: primaryServiceKeyOf })
            );
        } else {
            columnActions.push(copyAction("Copy source URL", task, (t) => attrsOf(t)?.userInput.url ?? ""));
        }
    }

    if (column?.id === "artist") {
        columnActions.push(copyAction("Copy artist", task, (t) => primaryResultOf(t)?.metadata.artists[0]?.name ?? ""));
    }

    if (column?.id === "track") {
        columnActions.push(copyAction("Copy track title", task, (t) => primaryResultOf(t)?.metadata.trackName ?? ""));
    }

    if (column && column.id.startsWith("metadataService-")) {
        const serviceKey = column.id.replace("metadataService-", "");
        const display = providerDisplayRegistry.get(serviceKey);
        columnLabel = display.label;
        columnColor = display.color;
        columnActions.push(...buildMetadataServiceColumnActions(serviceKey, task));
    }

    if (column && column.id.startsWith("discoveryService-")) {
        const serviceKey = column.id.replace("discoveryService-", "");
        const display = providerDisplayRegistry.get(serviceKey);
        columnLabel = display.label;
        columnColor = display.color;
        columnActions.push(...buildDiscoveryServiceColumnActions(serviceKey, task));
    }

    const { selectedCount, taskIndex, taskCount } = attributes;
    const taskRowLabel =
        selectedCount != null && selectedCount > 1
            ? `${selectedCount} selected tasks`
            : taskIndex != null && taskCount != null
              ? `Task ${taskIndex + 1}/${taskCount}`
              : "Task";

    return {
        rows: [
            { text: columnLabel, textColor: columnColor, actions: columnActions },
            { text: taskRowLabel, actions: taskActions },
        ],
    };
}

function buildMetadataServiceColumnActions(
    serviceKey: string,
    task: DownloadTask,
    {
        urlOf = (t) => sourceUrlFor(t, serviceKey),
        serviceKeyOf = () => serviceKey,
    }: { urlOf?: (t: DownloadTask) => string; serviceKeyOf?: (t: DownloadTask) => string | undefined } = {}
): ContextualActions[] {
    const display = providerDisplayRegistry.get(serviceKey);
    const group = task.getAttributes()?.metadataGroups.find((g) => g.serviceKey === serviceKey);
    const source = group?.results.find((r) => !r.isRejected) ?? group?.results[0];
    const url = source?.metadata.url ?? "";
    const actions: ContextualActions[] = [];
    if (url) {
        actions.push(copyAction(`Copy ${display.label} URL`, task, urlOf));
        const openTarget = source?.metadata.nativeAppUriDesktop ?? toOpenableUri(url);
        actions.push({
            shortcuts: [{ key: "return" }],
            label: `Open in ${display.label}`,
            onClick: () => {
                open(openTarget).catch(() => {});
            },
        });
    }
    actions.push({
        shortcuts: [{ input: "s" }],
        label: "Re-search",
        multiSelectAllowed: true,
        onClick: () => fire(task.startSingleProviderSearch(serviceKey)),
        onClickBatch: (tasks) =>
            runBatch(
                tasks,
                metadataLimiter,
                (t) => Boolean(serviceKeyOf(t)),
                (t) => t.startSingleProviderSearch(serviceKeyOf(t)!)
            ),
    });
    return actions;
}

function buildDiscoveryServiceColumnActions(serviceKey: string, task: DownloadTask): ContextualActions[] {
    const display = providerDisplayRegistry.get(serviceKey);
    const anchor = task.getAttributes()?.discoveryAnchors?.[serviceKey];
    const actions: ContextualActions[] = [];

    if (anchor?.url) {
        actions.push(
            copyAction(
                `Copy ${display.label} URL`,
                task,
                (t) => t.getAttributes()?.discoveryAnchors?.[serviceKey]?.url ?? ""
            )
        );
    }

    if (anchor?.openUri) {
        actions.push({
            shortcuts: [{ key: "return" }],
            label: serviceKey === "musicBrainz" ? `Open in MusicBrainz Picard` : `Open in ${display.label}`,
            onClick: () => {
                open(anchor.openUri!).catch(() => {});
            },
        });
    }

    if (serviceKey === "musicBrainz" && anchor?.url) {
        actions.push({
            shortcuts: [{ input: "o" }],
            label: "Open in MusicBrainz",
            onClick: () => {
                open(anchor.url!).catch(() => {});
            },
        });
    }

    actions.push({
        shortcuts: [{ input: "s" }],
        label: "Re-search",
        multiSelectAllowed: true,
        onClick: () => fire(task.startSingleProviderDiscovery(serviceKey)),
        onClickBatch: (tasks) =>
            runBatch(
                tasks,
                metadataLimiter,
                () => true,
                (t) => t.startSingleProviderDiscovery(serviceKey)
            ),
    });

    return actions;
}

// ── Collection (album/playlist parent) action bar ──────────────────────────

function toggleCollectionFlag(task: CollectionTask, flag: "toTag" | "toDownload"): void {
    const attrs = task.getAttributes();
    if (!attrs) return;
    const next = !attrs[flag];
    task.updateAttributes({ [flag]: next } as Partial<CollectionDownloadTask>);
    // A playlist/album's checkbox is also the template new tracks inherit — cascade
    // the same value to its existing children so toggling it doesn't feel partial.
    const children = TaskOrchestrator.getInstance()
        .getTasks()
        .filter((t) => attrs.childTaskIds.includes(t.getId()));
    for (const child of children) {
        (child as unknown as DownloadTask).updateAttributes({ [flag]: next } as Partial<TrackDownloadTask>);
    }
}

function buildCollectionContextualActionBar(task: CollectionTask, attributes: BarAttributes): ContextualActionBar {
    const orchestrator = TaskOrchestrator.getInstance();
    const column = attributes.columns[attributes.columnIndex];
    const attrs = task.getAttributes();
    const hasBeenRun = attrs?.state !== "pending" && attrs?.state !== "stopped";
    const hasChildren = (attrs?.childTaskIds.length ?? 0) > 0;
    const isPlaylist = attrs?.collectionKind === "playlist";

    const asCollection = (t: { getAttributes: () => unknown }) => t as unknown as CollectionTask;

    // ── Task row (bottom) ─────────────────────────────────────────────────
    const taskActions: ContextualActions[] = [
        {
            shortcuts: [{ input: "r" }],
            label: hasBeenRun ? "Restart" : "Start",
            description: hasBeenRun ? "Re-fetch the track list from scratch" : "Fetch the track list",
            multiSelectAllowed: true,
            onClick: () => fire(hasBeenRun ? task.restart() : task.start()),
            onClickBatch: (tasks) => {
                for (const t of tasks) {
                    const c = asCollection(t);
                    const a = c.getAttributes();
                    const run = a?.state !== "pending" && a?.state !== "stopped" ? c.restart() : c.start();
                    fire(run);
                }
            },
        },
    ];

    if (hasBeenRun) {
        taskActions.push({
            shortcuts: [{ input: "f" }],
            label: "Refetch",
            description: "Check for newly added tracks without resetting existing ones",
            multiSelectAllowed: true,
            onClick: () => fire(task.refetch()),
            onClickBatch: (tasks) => tasks.filter(isCollectionTask).forEach((t) => fire(t.refetch())),
        });
    }

    if (hasChildren) {
        taskActions.push({
            shortcuts: [{ input: "c" }],
            label: attrs?.collapsed ? "Expand" : "Collapse",
            multiSelectAllowed: true,
            onClick: () => task.toggleCollapsed(),
            onClickBatch: (tasks) => tasks.filter(isCollectionTask).forEach((t) => t.toggleCollapsed()),
        });
    }

    if (isPlaylist) {
        taskActions.push({
            shortcuts: [{ input: "l" }],
            label: attrs?.live?.enabled === false ? "Enable live refresh" : "Disable live refresh",
            description: "Periodically re-fetch this playlist for new tracks",
            multiSelectAllowed: true,
            onClick: () => task.toggleLive(),
            onClickBatch: (tasks) => tasks.filter(isCollectionTask).forEach((t) => t.toggleLive()),
        });
    }

    taskActions.push({
        shortcuts: [{ key: "delete" }],
        label: "Archive / Delete",
        description: hasChildren
            ? "Archive this and its tracks, or remove them from the list for good"
            : "Archive this, or remove it from the list for good",
        multiSelectAllowed: true,
        onClick: () => {
            const ids = [task.getId(), ...(attrs?.childTaskIds ?? [])];
            deleteConfirmBridge.request({
                taskCount: ids.length,
                apply: () => orchestrator.removeTasks(ids),
                archive: () => archive(ids),
            });
        },
        onClickBatch: (tasks) => {
            const ids = tasks.flatMap((t) => [t.getId(), ...(asCollection(t).getAttributes()?.childTaskIds ?? [])]);
            deleteConfirmBridge.request({
                taskCount: ids.length,
                apply: () => orchestrator.removeTasks(ids),
                archive: () => archive(ids),
            });
        },
    });

    // ── Column row (top) ──────────────────────────────────────────────────
    const columnActions: ContextualActions[] = [];
    const columnLabel = column?.label ?? "";
    const columnColor = column?.color;

    if (column?.id === "toTag") {
        columnActions.push({
            shortcuts: [{ key: "return" }],
            label: "Toggle tagging (+ existing tracks)",
            multiSelectAllowed: true,
            onClick: () => toggleCollectionFlag(task, "toTag"),
            onClickBatch: (tasks) => tasks.forEach((t) => toggleCollectionFlag(asCollection(t), "toTag")),
        });
    }

    if (column?.id === "toDownload") {
        columnActions.push({
            shortcuts: [{ key: "return" }],
            label: "Toggle downloading (+ existing tracks)",
            multiSelectAllowed: true,
            onClick: () => toggleCollectionFlag(task, "toDownload"),
            onClickBatch: (tasks) => tasks.forEach((t) => toggleCollectionFlag(asCollection(t), "toDownload")),
        });
    }

    if (column?.id === "url") {
        const url = attrs?.userInput.url ?? "";
        columnActions.push({
            shortcuts: [{ input: "c", ctrl: true }],
            label: "Copy source URL",
            multiSelectAllowed: true,
            onClick: () => clipboard.writeSync(url),
            onClickBatch: (tasks) =>
                clipboard.writeSync(
                    tasks
                        .map((t) => (t.getAttributes() as MusicDownloadTaskAttributes | undefined)?.userInput.url ?? "")
                        .filter((u) => u !== "")
                        .join("\n")
                ),
        });
        if (url) {
            const display = providerDisplayRegistry.get(attrs?.recognizedServiceKey ?? "unknown");
            columnActions.push({
                shortcuts: [{ key: "return" }],
                label: `Open in ${display.label}`,
                onClick: () => {
                    open(toOpenableUri(url)).catch(() => {});
                },
            });
        }
    }

    const { selectedCount, taskIndex, taskCount } = attributes;
    const taskRowLabel =
        selectedCount != null && selectedCount > 1
            ? `${selectedCount} selected tasks`
            : taskIndex != null && taskCount != null
              ? `Task ${taskIndex + 1}/${taskCount}`
              : "Task";

    return {
        rows: [
            { text: columnLabel, textColor: columnColor, actions: columnActions },
            { text: taskRowLabel, actions: taskActions },
        ],
    };
}
