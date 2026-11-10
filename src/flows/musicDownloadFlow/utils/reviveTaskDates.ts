import {
    type MusicDownloadTaskAttributes,
    type TrackDownloadTask,
    type CollectionDownloadTask,
} from "#flows/musicDownloadFlow/types";
import { savedFileFromLegacyRows } from "./savedSource";

function reviveTrackDates(attrs: TrackDownloadTask): TrackDownloadTask {
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
export function reviveTaskDates(attrs: MusicDownloadTaskAttributes): MusicDownloadTaskAttributes {
    if (attrs.kind === "collection") return reviveCollectionDates(attrs);
    return reviveTrackDates(attrs);
}
