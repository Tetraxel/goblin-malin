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

/** What `releaseSavedFile` needs from a task (any `Task` of the music flow fits). */
export interface SavedFileHolder {
    getId(): string;
    getAttributes(): { kind?: string; savedFile?: SavedFile } | undefined;
    updateAttributes(attributes: { savedFile: undefined }): void;
}

/**
 * A file belongs to one task. When `ownerId` has just written `filePath` (replacing a file the user agreed to
 * replace), every other task that still recorded it as its own saved file lets go of it: that file is no longer
 * what it saved, and re-tagging, renaming or deleting it from there would hit the new owner's file.
 * Returns the ids of the tasks that were released.
 */
export function releaseSavedFile(tasks: readonly SavedFileHolder[], filePath: string, ownerId: string): string[] {
    const released: string[] = [];
    for (const task of tasks) {
        if (task.getId() === ownerId) continue;
        const attrs = task.getAttributes();
        if (attrs?.kind !== "track" || !attrs.savedFile || !samePath(attrs.savedFile.path, filePath)) continue;
        task.updateAttributes({ savedFile: undefined });
        released.push(task.getId());
    }
    return released;
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
