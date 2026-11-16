/**
 * Lets plain-TS code (a task action) say which task the list cursor should land on once the list has changed, without
 * knowing anything about React: a new group's row is not in the list yet when the action runs, so the cursor cannot be
 * moved by index. The focus manager takes the request the next time the visible task ids change.
 */

/** A request nobody could honour (the task never showed up in the list) is dropped after this long. */
const REQUEST_TTL_MS = 2000;

let target: { id: string; at: number } | null = null;

export const taskCursorBridge = {
    /** Ask for the cursor to go to this task as soon as it is in the list. */
    request(taskId: string): void {
        target = { id: taskId, at: Date.now() };
    },
    /**
     * The index to move the cursor to, if a request is waiting and its task is in `taskIds`. Does not consume the
     * request, so it is safe to call while rendering (React may run a render twice, or throw one away): the committed
     * render then calls {@link take}.
     */
    peek(taskIds: readonly string[]): number | undefined {
        if (!target) return undefined;
        const index = taskIds.indexOf(target.id);
        return index >= 0 ? index : undefined;
    },
    /** Like {@link peek}, and clears the request once it is served (or has waited too long). Not for render. */
    take(taskIds: readonly string[]): number | undefined {
        if (!target) return undefined;
        const index = taskIds.indexOf(target.id);
        if (index >= 0) {
            target = null;
            return index;
        }
        if (Date.now() - target.at > REQUEST_TTL_MS) target = null;
        return undefined;
    },
};
