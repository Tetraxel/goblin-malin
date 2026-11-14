import { useEffect, useEffectEvent } from "react";
import { type Task, type TaskSnapshot } from "#base/task/task";

/**
 * Keeps `snapshot`, state the component already filled with `task.get()` while rendering, in step with `task`.
 *
 * It subscribes without the replay of `Task.subscribe` (`immediate: false`): the replay would set the snapshot the
 * render just read, and React only skips a same-value `setState` when the component has no pending work. Every other
 * selection change it did not, and re-rendered for nothing: an empty commit, which Ink paints as a second full frame
 * on Windows (it always redraws a full-screen frame there, even an unchanged one). A change made between that render
 * and the subscription is still caught: `Task.get()` then returns another object.
 */
export function useFollowTaskSnapshot<TAttributes>(
    task: Task<TAttributes> | null,
    snapshot: TaskSnapshot<TAttributes> | undefined,
    setSnapshot: (snapshot: TaskSnapshot<TAttributes>) => void
): void {
    const catchUp = useEffectEvent((current: Task<TAttributes>) => {
        const latest = current.get();
        if (latest !== snapshot) setSnapshot(latest);
    });

    useEffect(() => {
        if (!task) return;
        const unsubscribe = task.subscribe((t) => setSnapshot(t.get()), { immediate: false });
        catchUp(task);
        return unsubscribe;
    }, [task, setSnapshot]);
}
