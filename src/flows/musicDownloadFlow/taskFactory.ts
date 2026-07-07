import { globalLogger } from "#base/logger/logger";
import { TaskOrchestrator } from "#base/task/orchestrator";
import { TaskSnapshot } from "#base/task/task";
import { DownloadTask } from "./utils/downloadTask";
import { CollectionTask } from "./utils/collectionTask";
import { buildTrackTask, reviveTrackTask } from "./utils/buildTrackTask";
import { taskIdFromUrl } from "./utils/taskId";
import { resolveCollectionRecognition } from "./utils/resolveCollectionRecognition";
import { reviveTaskDates } from "./utils/reviveTaskDates";
import { MusicDownloadTaskAttributes, TrackDownloadTask, CollectionDownloadTask } from "./types";
import { metadataServiceRegistry } from "./registries";

const logger = globalLogger.createChild({ service: "MusicDownload" });

export type MusicTask = DownloadTask | CollectionTask;

export function createTasksFromUrls(urls: string[], opts: { toTag?: boolean; toDownload?: boolean } = {}): MusicTask[] {
    const { toTag = true, toDownload = false } = opts;
    return urls.map((url) => {
        // Collections are recognized the same way tracks are — purely from parseUrl,
        // no network call. A recognized album/playlist becomes a parent task; its
        // track list is only fetched once the task is started.
        const collection = resolveCollectionRecognition(url, metadataServiceRegistry);
        if (collection) {
            const attributes: CollectionDownloadTask = {
                kind: "collection",
                collectionKind: collection.collectionKind,
                state: "pending",
                userInput: { type: "url", url },
                recognizedServiceKey: collection.serviceKey,
                childTaskIds: [],
                collapsed: false,
                toTag,
                toDownload,
                live: collection.collectionKind === "playlist" ? { enabled: true } : undefined,
            };
            return new CollectionTask({ id: taskIdFromUrl(url), initialInput: url, attributes, logger });
        }
        return buildTrackTask(url, { toTag, toDownload });
    });
}

export function createTasksFromSnapshots(snapshots: TaskSnapshot[]): MusicTask[] {
    return snapshots.map((snap) => {
        const rawAttrs = snap.attributes as MusicDownloadTaskAttributes | undefined;

        if (rawAttrs?.kind === "collection") {
            const attributes = reviveTaskDates(rawAttrs) as CollectionDownloadTask;
            return new CollectionTask({
                id: snap.id,
                initialInput: snap.initialInput,
                attributes,
                initialStatus: snap.status,
                logger,
            });
        }

        // Legacy snapshots predate the `kind` discriminant — treat those (and any
        // snapshot that isn't a collection) as a track.
        const normalized: TrackDownloadTask | undefined = rawAttrs
            ? ({ ...rawAttrs, kind: "track" } as TrackDownloadTask)
            : undefined;
        const attributes = normalized ? (reviveTaskDates(normalized) as TrackDownloadTask) : undefined;
        return reviveTrackTask({
            id: snap.id,
            initialInput: snap.initialInput,
            attributes,
            initialStatus: snap.status,
        });
    });
}

/** Add tasks to the queue, skipping ids already present (or duplicated in the batch). */
export function importTasks(tasks: MusicTask[]): void {
    const orchestrator = TaskOrchestrator.getInstance();
    const existingIds = new Set(orchestrator.getTasks().map((t) => t.getId()));
    const seen = new Set<string>();
    const newTasks: MusicTask[] = [];
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
