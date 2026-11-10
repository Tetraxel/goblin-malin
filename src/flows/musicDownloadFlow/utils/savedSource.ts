import { type SavedFile, type TrackDownloadSource } from "../types";
import { samePath } from "./computeOutputPath";

/**
 * A row standing in for the saved file, so the UI can show it with the components that show a download (the
 * pinned row, the detail pane, the comparison with another source). It is never part of `downloadSources`.
 * It has no `localFile`: what it plays and re-tags is the saved file itself.
 */
export function savedFileAsSource(saved: SavedFile): TrackDownloadSource & { savedFile: SavedFile } {
    return {
        state: "downloaded",
        provider: saved.provider,
        track: saved.track,
        providerDetail: saved.providerDetail,
        fileInfo: saved.fileInfo,
        downloadedAt: saved.savedAt,
        selected: false,
        savedFile: saved,
    };
}

/** Whether the saved file was made from the download this row holds (the same temporary file). */
export function isSavedFrom(saved: SavedFile | undefined, source: TrackDownloadSource): boolean {
    const downloadPath = source.localFile?.path;
    return !!saved?.downloadPath && !!downloadPath && samePath(saved.downloadPath, downloadPath);
}

/**
 * The saved file of a track loaded from a session written by an older version, which kept it on the download row
 * it was made from. `undefined` when no row has one.
 */
export function savedFileFromLegacyRows(sources: readonly TrackDownloadSource[]): SavedFile | undefined {
    const row = sources.find((s) => s.savedFile);
    if (!row?.savedFile) return undefined;
    return {
        ...row.savedFile,
        provider: row.savedFile.provider ?? row.provider,
        track: row.savedFile.track ?? row.track,
        providerDetail: row.savedFile.providerDetail ?? row.providerDetail,
        fileInfo: row.savedFile.fileInfo ?? row.fileInfo,
        downloadPath: row.savedFile.downloadPath ?? row.localFile?.path,
    };
}
