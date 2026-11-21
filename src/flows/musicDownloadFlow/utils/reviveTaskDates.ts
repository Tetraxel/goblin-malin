import {
    type MusicDownloadTaskAttributes,
    type TrackDownloadTask,
    type CollectionDownloadTask,
} from "#flows/musicDownloadFlow/types";
import { savedFileFromLegacyRows } from "./savedSource";
import { withSearch } from "./groupSearch";

/** Rows and results that were saved as `null` (holes left by a write to a row that was gone) are dropped. */
const present = <T>(items: readonly (T | null | undefined)[] | undefined): T[] =>
    (items ?? []).filter((item): item is T => item !== null && item !== undefined);

function reviveTrackDates(raw: TrackDownloadTask): TrackDownloadTask {
    // Nothing is searching in a task that was just loaded: a search that was cut off ended with the app.
    const rest = { ...raw };
    delete rest.lastResortInProgress;
    const attrs: TrackDownloadTask = {
        ...rest,
        downloadSources: present(raw.downloadSources),
        metadataGroups: present(raw.metadataGroups).map((group) => ({
            ...(group.search === "searching" ? withSearch(group, "skipped") : group),
            results: present(group.results),
        })),
    };
    // Older sessions kept the saved file on the download row it was made from.
    const savedFile = attrs.savedFile ?? savedFileFromLegacyRows(attrs.downloadSources);
    return {
        ...attrs,
        savedFile: savedFile ? { ...savedFile, savedAt: new Date(savedFile.savedAt) } : undefined,
        metadataGroups: attrs.metadataGroups.map((group) => ({
            ...group,
            results: group.results.map((result) => ({
                ...result,
                metadata: {
                    ...result.metadata,
                    fetchedAt: new Date(result.metadata.fetchedAt),
                },
            })),
        })),
        downloadSources: attrs.downloadSources.map((source) => ({
            ...source,
            downloadedAt: new Date(source.downloadedAt),
            savedFile: undefined,
            localFile: source.localFile ? { ...source.localFile } : undefined,
        })),
    };
}

function reviveCollectionDates(attrs: CollectionDownloadTask): CollectionDownloadTask {
    return {
        ...attrs,
        live: attrs.live
            ? {
                  ...attrs.live,
                  lastFetchedAt: attrs.live.lastFetchedAt ? new Date(attrs.live.lastFetchedAt) : undefined,
                  lastAttemptAt: attrs.live.lastAttemptAt ? new Date(attrs.live.lastAttemptAt) : undefined,
              }
            : undefined,
    };
}

// Callers must normalize legacy snapshots (predating the `kind` discriminant) to
// `kind: "track"` before calling this — see taskFactory.createTasksFromSnapshots.
export function reviveTaskDates(saved: MusicDownloadTaskAttributes): MusicDownloadTaskAttributes {
    // Nothing is running in a task that was just loaded: a saved "running" state is a run that was cut off (the app was
    // closed or killed). Left as it is, the task would be "busy" for ever: it could not be archived or deleted, and
    // it would stop sessions from being switched.
    const attrs: MusicDownloadTaskAttributes = saved.state === "running" ? { ...saved, state: "stopped" } : saved;
    if (attrs.kind === "collection") return reviveCollectionDates(attrs);
    return reviveTrackDates(attrs);
}
