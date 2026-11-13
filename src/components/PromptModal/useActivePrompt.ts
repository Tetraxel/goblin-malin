// hooks/useActivePrompt.ts
import { type Task } from "#base/task/task";
import { type TaskPrompt } from "#base/task/task-prompt";
import { pendingPrompts } from "#base/task/pending-prompts";
import { usePendingPromptLookup } from "#hooks/usePendingPromptLookup";

interface ActivePromptResult {
    task: Task | null;
    prompt: TaskPrompt | null;
}

const NONE: ActivePromptResult = { task: null, prompt: null };

const getFirstPendingPrompt = (tasks: Task[]): ActivePromptResult => {
    // The common case, and O(1): nobody is waiting for the user, so there is nothing to look for in the list.
    if (!pendingPrompts.hasAny()) return NONE;
    const task = tasks.find((t) => t.getPrompt().isPendingUserInput()) || null;
    return task ? { task, prompt: task.getPrompt() } : NONE;
};

// Only change the active prompt if there is no current active prompt
const isStillAsking = (prev: ActivePromptResult): boolean => !!prev.task?.getPrompt().getCurrentPrompt();

/**
 * Returns the first task (in list order) with a pending prompt, and keeps showing it until it is answered.
 * It follows `pendingPrompts` (told by each `TaskPrompt` when it gains or loses a question) instead of subscribing
 * to every task, so its cost does not depend on how many tasks there are.
 */
export const useActivePrompt = (tasks: Task[]): ActivePromptResult =>
    usePendingPromptLookup(tasks, getFirstPendingPrompt, isStillAsking);
