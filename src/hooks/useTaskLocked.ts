import { useSyncExternalStore } from "react";
import { taskLocks } from "#base/task/taskLock";

const subscribe = (listener: () => void): (() => void) => taskLocks.subscribe(listener);

/**
 * Whether Claude (or anyone else) holds this task right now. A boolean snapshot: a lock change on another task
 * re-renders nothing here, and the list does not subscribe to every task for it.
 */
export function useTaskLocked(taskId: string): boolean {
    return useSyncExternalStore(subscribe, () => taskLocks.isLocked(taskId));
}
