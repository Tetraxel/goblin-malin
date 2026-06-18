import { MusicDownloadTaskAttributes } from "#flows/musicDownloadFlow/types";

export function reviveTaskDates(attrs: MusicDownloadTaskAttributes): MusicDownloadTaskAttributes {
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
