import { MusicDownloadTaskAttributes, TrackDownloadTask, CollectionDownloadTask } from "#flows/musicDownloadFlow/types";

function reviveTrackDates(attrs: TrackDownloadTask): TrackDownloadTask {
    return {
        ...attrs,
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
            savedFile: source.savedFile
                ? { ...source.savedFile, savedAt: new Date(source.savedFile.savedAt) }
                : undefined,
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
