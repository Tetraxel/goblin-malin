import { globalLogger } from "#base/logger/logger";
import { TaskOrchestrator } from "#base/task/orchestrator";
import { TaskSnapshot } from "#base/task/task";
import { DownloadTask } from "./utils/downloadTask";
import { taskIdFromUrl } from "./utils/taskId";
import { resolveTrackRecognition } from "./utils/resolveTrackRecognition";
import { reviveTaskDates } from "./utils/reviveTaskDates";
import { MusicDownloadTaskAttributes } from "./types";
import { metadataServiceRegistry, discoveryServiceRegistry, downloadServiceRegistry } from "./registries";
import { getMusicSettings } from "./settings";

const logger = globalLogger.createChild({ service: "MusicDownload" });

// Enabled-state checks read the live settings on every call so a settings
// change applies to running tasks without recreating them.
const isMetadataServiceEnabled = (key: string): boolean =>
    getMusicSettings().metadata.providers[key]?.enabled !== false;
const isDiscoveryServiceEnabled = (key: string): boolean =>
    getMusicSettings().metadata.discoveryProviders[key]?.enabled !== false;
const isDownloadServiceEnabled = (key: string): boolean =>
    getMusicSettings().download.providers[key]?.enabled !== false;

export function createTasksFromUrls(
    urls: string[],
    opts: { toTag?: boolean; toDownload?: boolean } = {}
): DownloadTask[] {
    const { toTag = true, toDownload = false } = opts;
    return urls.map((url) => {
        // Recognize the URL once, at import time, so the task carries its uri from
        // the start (before any fetch). Absent ⇒ "Unknown".
        const recognition = resolveTrackRecognition(url, metadataServiceRegistry);
        return new DownloadTask({
            id: taskIdFromUrl(url),
            initialInput: url,
            attributes: {
                state: "pending",
                userInput: { type: "url", url },
                uri: recognition?.uri,
                recognizedServiceKey: recognition?.serviceKey,
                metadataGroups: [],
                metadataOverride: {},
                downloadSources: [],
                toTag,
                toDownload,
            },
            logger,
            metadataServiceRegistry,
            discoveryServiceRegistry,
            downloadServiceRegistry,
            isMetadataServiceEnabled,
            isDiscoveryServiceEnabled,
            isDownloadServiceEnabled,
        });
    });
}

export function createTasksFromSnapshots(snapshots: TaskSnapshot[]): DownloadTask[] {
    return snapshots.map((snap) => {
        const rawAttrs = snap.attributes as MusicDownloadTaskAttributes | undefined;
        const attributes = rawAttrs ? reviveTaskDates(rawAttrs) : undefined;
        return new DownloadTask({
            id: snap.id,
            initialInput: snap.initialInput,
            attributes,
            initialStatus: snap.status,
            logger,
            metadataServiceRegistry,
            discoveryServiceRegistry,
            downloadServiceRegistry,
            isMetadataServiceEnabled,
            isDiscoveryServiceEnabled,
            isDownloadServiceEnabled,
        });
    });
}

/** Add tasks to the queue, skipping ids already present (or duplicated in the batch). */
export function importTasks(tasks: DownloadTask[]): void {
    const orchestrator = TaskOrchestrator.getInstance();
    const existingIds = new Set(orchestrator.getTasks().map((t) => t.getId()));
    const seen = new Set<string>();
    const newTasks: DownloadTask[] = [];
    let skippedCount = 0;

    for (const task of tasks) {
        const id = task.getId();
        if (existingIds.has(id) || seen.has(id)) {
            skippedCount++;
            continue;
        }
        seen.add(id);
        newTasks.push(task);
    }

    if (skippedCount > 0) logger.info(`Skipped ${skippedCount} task(s) already in queue`);
    if (newTasks.length > 0) {
        orchestrator.addTasks(newTasks);
        logger.info(`Imported ${newTasks.length} new task(s)`);
    }
}
