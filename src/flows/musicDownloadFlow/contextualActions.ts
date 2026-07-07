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
import { runSelected } from "./runController";
import { MusicDownloadTaskAttributes } from "./types";

// Suppress the re-throw from @SafeAction — logging is already handled by the decorator.
const fire = (p: Promise<void>): void => {
    p.catch(() => {});
};

function toOpenableUri(url: string): string {
    const m = url.match(/open\.spotify\.com\/(track|album|artist|playlist)\/([A-Za-z0-9]+)/);
    if (m) return `spotify:${m[1]}:${m[2]}`;
    return url;
}

/**
 * Build the two-row contextual action bar (column actions + task actions) for
 * the selected task/column. Callers pass the columns they currently render so
 * there is exactly one column source (App's memo).
 */
export function buildContextualActionBar(
    task: DownloadTask,
    attributes: {
        columns: ColumnDefinition<MusicDownloadTaskAttributes>[];
        columnIndex: number;
        taskIndex?: number;
        taskCount?: number;
        selectedCount?: number;
    }
): ContextualActionBar {
    const orchestrator = TaskOrchestrator.getInstance();
    const column = attributes.columns[attributes.columnIndex];
    const attrs = task.getAttributes();

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
        label: "Delete",
        description: "Remove this task from the list",
        multiSelectAllowed: true,
        onClick: () =>
            deleteConfirmBridge.request({
                taskCount: 1,
                apply: () => orchestrator.removeTasks([task.getId()]),
            }),
        onClickBatch: (tasks) =>
            deleteConfirmBridge.request({
                taskCount: tasks.length,
                apply: () => orchestrator.removeTasks(tasks.map((t) => t.getId())),
            }),
    });
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
        const primaryGroup = attrs?.metadataGroups.find((g) =>
            g.results.some((r) => r.isPrimaryInput && (r.metadata.url || r.metadata.uri))
        );
        const serviceKey = primaryGroup?.serviceKey ?? attrs?.recognizedServiceKey;
        if (serviceKey) {
            columnActions.push(...buildMetadataServiceColumnActions(serviceKey, attrs, task));
        } else {
            columnActions.push({
                shortcuts: [{ input: "c", ctrl: true }],
                label: "Copy source URL",
                onClick: () => clipboard.writeSync(attrs?.userInput.url ?? ""),
            });
        }
    }

    if (column?.id === "artist") {
        const primary = attrs?.metadataGroups.flatMap((g) => g.results).find((r) => r.isPrimaryInput);
        columnActions.push({
            shortcuts: [{ input: "c", ctrl: true }],
            label: "Copy artist",
            onClick: () => clipboard.writeSync(primary?.metadata.artists[0]?.name ?? ""),
        });
    }

    if (column?.id === "track") {
        const primary = attrs?.metadataGroups.flatMap((g) => g.results).find((r) => r.isPrimaryInput);
        columnActions.push({
            shortcuts: [{ input: "c", ctrl: true }],
            label: "Copy track title",
            onClick: () => clipboard.writeSync(primary?.metadata.trackName ?? ""),
        });
    }

    if (column && column.id.startsWith("metadataService-")) {
        const serviceKey = column.id.replace("metadataService-", "");
        const display = providerDisplayRegistry.get(serviceKey);
        columnLabel = display.label;
        columnColor = display.color;
        columnActions.push(...buildMetadataServiceColumnActions(serviceKey, attrs, task));
    }

    if (column && column.id.startsWith("discoveryService-")) {
        const serviceKey = column.id.replace("discoveryService-", "");
        const display = providerDisplayRegistry.get(serviceKey);
        columnLabel = display.label;
        columnColor = display.color;
        columnActions.push(...buildDiscoveryServiceColumnActions(serviceKey, attrs, task));
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
    attrs: MusicDownloadTaskAttributes | undefined,
    task: DownloadTask
): ContextualActions[] {
    const display = providerDisplayRegistry.get(serviceKey);
    const group = attrs?.metadataGroups.find((g) => g.serviceKey === serviceKey);
    const source = group?.results.find((r) => !r.isRejected) ?? group?.results[0];
    const url = source?.metadata.url ?? "";
    const actions: ContextualActions[] = [];
    if (url) {
        actions.push({
            shortcuts: [{ input: "c", ctrl: true }],
            label: `Copy ${display.label} URL`,
            onClick: () => clipboard.writeSync(url),
        });
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
        onClick: () => fire(task.startSingleProviderSearch(serviceKey)),
    });
    return actions;
}

function buildDiscoveryServiceColumnActions(
    serviceKey: string,
    attrs: MusicDownloadTaskAttributes | undefined,
    task: DownloadTask
): ContextualActions[] {
    const display = providerDisplayRegistry.get(serviceKey);
    const anchor = attrs?.discoveryAnchors?.[serviceKey];
    const actions: ContextualActions[] = [];

    if (anchor?.url) {
        actions.push({
            shortcuts: [{ input: "c", ctrl: true }],
            label: `Copy ${display.label} URL`,
            onClick: () => clipboard.writeSync(anchor.url!),
        });
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
        onClick: () => fire(task.startSingleProviderDiscovery(serviceKey)),
    });

    return actions;
}
