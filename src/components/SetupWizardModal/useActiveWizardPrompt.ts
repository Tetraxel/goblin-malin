import { useEffect, useState } from "react";
import { Task } from "#base/task/task";
import { TaskPrompt } from "#base/task/task-prompt";
import { PromptType, SetupWizardPrompt } from "#base/task/task-prompt";
import { SetupWizardConfig } from "#base/setupWizard";

interface ActiveWizardPromptResult {
    task: Task | null;
    prompt: TaskPrompt | null;
    config: SetupWizardConfig | null;
}

const NULL_RESULT: ActiveWizardPromptResult = { task: null, prompt: null, config: null };

function getFirstWizardPrompt(tasks: Task[]): ActiveWizardPromptResult {
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

export const useActiveWizardPrompt = (tasks: Task[]): ActiveWizardPromptResult => {
    const [active, setActive] = useState<ActiveWizardPromptResult>(() => getFirstWizardPrompt(tasks));

    useEffect(() => {
        const update = () => {
            setActive((prev) => {
                if (prev.task?.getPrompt().getCurrentPrompt()?.type === PromptType.SetupWizard) return prev;
                return getFirstWizardPrompt(tasks);
            });
        };

        const unsubscribers = tasks.map((task) => task.subscribe(() => update()));
        update();
        return () => {
            unsubscribers.forEach((u) => u());
        };
    }, [tasks]);

    return active;
};
