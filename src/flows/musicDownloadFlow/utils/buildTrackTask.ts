import { globalLogger } from "#base/logger/logger";
import { StatusAttributes } from "#base/task/task-status";
import { DownloadTask } from "./downloadTask";
import { taskIdFromUrl } from "./taskId";
import { resolveTrackRecognition } from "./resolveTrackRecognition";
import { TrackDownloadTask } from "../types";
import { metadataServiceRegistry, discoveryServiceRegistry, downloadServiceRegistry } from "../registries";
import { getMusicSettings } from "../settings";

const logger = globalLogger.createChild({ service: "MusicDownload" });

// Enabled-state checks read the live settings on every call so a settings
// change applies to running tasks without recreating them.
const isMetadataServiceEnabled = (key: string): boolean =>
    getMusicSettings().metadata.providers[key]?.enabled !== false;
const isDiscoveryServiceEnabled = (key: string): boolean =>
    getMusicSettings().metadata.discoveryProviders[key]?.enabled !== false;
const isDownloadServiceEnabled = (key: string): boolean =>
    getMusicSettings().download.providers[key]?.enabled !== false;

/**
 * Build a fresh DownloadTask for a track URL. `parentTaskId` tags it as a child
 * spawned by a CollectionTask's expansion (fresh expand or refetch) — omit it for
 * a plain, directly-imported track URL.
 */
export function buildTrackTask(
    url: string,
    opts: { toTag?: boolean; toDownload?: boolean; parentTaskId?: string } = {}
): DownloadTask {
    const { toTag = true, toDownload = false, parentTaskId } = opts;
    // Recognize the URL once, at creation time, so the task carries its uri from
    // the start (before any fetch). Absent ⇒ "Unknown".
    const recognition = resolveTrackRecognition(url, metadataServiceRegistry);
    return new DownloadTask({
        id: taskIdFromUrl(url),
        initialInput: url,
        attributes: {
            kind: "track",
            state: "pending",
            userInput: { type: "url", url },
            uri: recognition?.uri,
            recognizedServiceKey: recognition?.serviceKey,
            parentTaskId,
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
}

/** Rebuild a DownloadTask from a persisted snapshot (session reload). */
export function reviveTrackTask(params: {
    id: string;
    initialInput?: string;
    attributes?: TrackDownloadTask;
    initialStatus?: StatusAttributes;
}): DownloadTask {
    return new DownloadTask({
        ...params,
        logger,
        metadataServiceRegistry,
        discoveryServiceRegistry,
        downloadServiceRegistry,
        isMetadataServiceEnabled,
        isDiscoveryServiceEnabled,
        isDownloadServiceEnabled,
    });
}
