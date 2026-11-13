import { type Task } from "#base/task/task";
import { type TaskPrompt } from "#base/task/task-prompt";
import { PromptType, type SetupWizardPrompt } from "#base/task/task-prompt";
import { pendingPrompts } from "#base/task/pending-prompts";
import { usePendingPromptLookup } from "#hooks/usePendingPromptLookup";
import { type SetupWizardConfig } from "#base/setupWizard";

interface ActiveWizardPromptResult {
    task: Task | null;
    prompt: TaskPrompt | null;
    config: SetupWizardConfig | null;
}

const NULL_RESULT: ActiveWizardPromptResult = { task: null, prompt: null, config: null };

function getFirstWizardPrompt(tasks: Task[]): ActiveWizardPromptResult {
    // O(1) when nobody is waiting for the user (see `pendingPrompts`).
    if (!pendingPrompts.hasAny()) return NULL_RESULT;
    for (const task of tasks) {
        const p = task.getPrompt();
        const current = p.getCurrentPrompt();
        if (current?.type === PromptType.SetupWizard) {
            return {
                task,
                prompt: p,
                config: (current as SetupWizardPrompt).config,
            };
        }
    }
    return NULL_RESULT;
}

const isStillAWizard = (prev: ActiveWizardPromptResult): boolean =>
    prev.task?.getPrompt().getCurrentPrompt()?.type === PromptType.SetupWizard;

export const useActiveWizardPrompt = (tasks: Task[]): ActiveWizardPromptResult =>
    usePendingPromptLookup(tasks, getFirstWizardPrompt, isStillAWizard);
