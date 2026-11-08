import type { TrackDownloadSource } from "../types";

/**
 * The file a source can be previewed from (and saved from): its temporary copy while that is there, otherwise
 * the saved file — the temporary copy of a saved track may have been cleaned up, which must not take the player
 * and the Save/Update key with it. `null` when neither exists.
 */
export function playableFilePath(source: Pick<TrackDownloadSource, "localFile" | "savedFile">): string | null {
    if (source.localFile?.state === "found" && source.localFile.path) return source.localFile.path;
    return source.savedFile?.path ?? null;
}
