import { Task, TaskAttributes } from "#base/task/task";
import { MusicDownloadTaskAttributes } from "../types";

/**
 * Reorders the orchestrator's flat task list for display: each collection
 * (album/playlist) parent is immediately followed by its children — wherever
 * those children actually sit in the underlying array (they're appended at the
 * end when a collection is started/refetched) — and a collapsed parent's
 * children are dropped entirely. Everything else keeps its relative order.
 *
 * Pure and orchestrator-agnostic: the orchestrator itself stays a flat,
 * content-agnostic task list (per P20b) — this is purely a rendering concern.
 */
export function buildVisibleTaskOrder(tasks: Task<TaskAttributes>[]): Task<TaskAttributes>[] {
    const taskIds = new Set(tasks.map((t) => t.getId()));

    // A parentTaskId only counts if that parent is actually still in the list —
    // otherwise (e.g. the parent was deleted independently of its children) treat
    // the track as a normal top-level row rather than silently hiding it.
    const parentIdOf = (task: Task<TaskAttributes>): string | undefined => {
        const attrs = task.getAttributes() as MusicDownloadTaskAttributes | undefined;
        const parentId = attrs?.kind === "track" ? attrs.parentTaskId : undefined;
        return parentId && taskIds.has(parentId) ? parentId : undefined;
    };

    const childrenByParent = new Map<string, Task<TaskAttributes>[]>();
    for (const task of tasks) {
        const parentId = parentIdOf(task);
        if (!parentId) continue;
        const siblings = childrenByParent.get(parentId);
        if (siblings) siblings.push(task);
        else childrenByParent.set(parentId, [task]);
    }

    const result: Task<TaskAttributes>[] = [];
    for (const task of tasks) {
        if (parentIdOf(task)) continue; // placed alongside its parent below, not here

        result.push(task);

        const attrs = task.getAttributes() as MusicDownloadTaskAttributes | undefined;
        if (attrs?.kind === "collection" && !attrs.collapsed) {
            const children = childrenByParent.get(task.getId());
            if (children) result.push(...children);
        }
    }

    return result;
}
