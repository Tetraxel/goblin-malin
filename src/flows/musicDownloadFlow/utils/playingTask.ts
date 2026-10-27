import type { Task } from "#base/task/task";
import type { MusicDownloadTaskAttributes } from "../types";

/** Whether one of this track task's downloaded files is the file at `filePath`. */
export function attributesPlayFile(attrs: MusicDownloadTaskAttributes | undefined, filePath: string): boolean {
    return attrs?.kind === "track" && attrs.downloadSources.some((s) => s.localFile?.path === filePath);
}

/** Path of the first non-rejected source of this track task whose downloaded file is on disk. */
export function firstPlayableFilePath(attrs: MusicDownloadTaskAttributes | undefined): string | undefined {
    if (attrs?.kind !== "track") return undefined;
    return attrs.downloadSources.find((s) => !s.isRejected && s.localFile?.state === "found" && s.localFile.path)
        ?.localFile?.path;
}

/** Id of the task whose download is `filePath` (what the player is playing), if it's in `tasks`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function findPlayingTaskId(tasks: Task<any>[], filePath: string): string | undefined {
    return tasks.find((t) => attributesPlayFile(t.getAttributes(), filePath))?.getId();
}
