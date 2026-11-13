import { useState, useSyncExternalStore } from "react";
import { type Task } from "#base/task/task";
import { pendingPrompts } from "#base/task/pending-prompts";

/**
 * Finds the task whose prompt a modal should show, without subscribing to the tasks.
 *
 * The lookup is re-done when the task list changes or when a prompt appears or goes away anywhere (`pendingPrompts`),
 * and not when some task merely updates its progress. `find` is O(1) while nobody is waiting for the user, so the
 * hook costs nothing in the normal case, however many tasks there are.
 *
 * `keep` says whether the previous answer should stay: a prompt being answered is not replaced by another one that
 * appeared in the meantime.
 *
 * The result is adjusted while rendering (React re-renders at once, with no extra commit), not in an effect.
 */
export function usePendingPromptLookup<T extends { task: Task | null }>(
    tasks: Task[],
    find: (tasks: Task[]) => T,
    keep: (previous: T) => boolean
): T {
    const version = useSyncExternalStore(pendingPrompts.subscribe, pendingPrompts.getVersion);
    const [state, setState] = useState(() => ({ tasks, version, value: find(tasks) }));

    if (state.tasks !== tasks || state.version !== version) {
        let value = state.value;
        if (!keep(value)) {
            const next = find(tasks);
            // Same task → same answer object, so consumers memoised on it don't see a change.
            if (next.task !== value.task) value = next;
        }
        setState({ tasks, version, value });
    }
    return state.value;
}
