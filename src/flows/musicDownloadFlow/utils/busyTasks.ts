import { type MusicDownloadTaskAttributes } from "#flows/musicDownloadFlow/types";

/** What this needs to know of a task (the orchestrator's tasks all have it). */
type Busyable = { getId(): string; isBusy(): boolean; getAttributes(): unknown };

/**
 * Of the tasks asked to be removed or archived, the ones that may go now. A task being worked on never goes (the work
 * would run on with nothing left to stop it), and an album, playlist or group goes whole or not at all: taking the
 * collection and its idle tracks while one track still runs would leave that track in the list under a parent that
 * is gone.
 *
 * `lookup` finds any task by id: a collection's tracks are checked even when the caller did not ask for them.
 */
export function withoutBusy<T extends Busyable>(
    requested: readonly T[],
    lookup: (id: string) => Busyable | undefined
): T[] {
    const blocked = new Set<string>();
    for (const task of requested) {
        const busy = task.isBusy();
        if (busy) blocked.add(task.getId());
        const attrs = task.getAttributes() as MusicDownloadTaskAttributes | undefined;
        if (attrs?.kind !== "collection") continue;
        if (busy || attrs.childTaskIds.some((id) => lookup(id)?.isBusy())) {
            blocked.add(task.getId());
            for (const id of attrs.childTaskIds) blocked.add(id);
        }
    }
    return requested.filter((task) => !blocked.has(task.getId()));
}
