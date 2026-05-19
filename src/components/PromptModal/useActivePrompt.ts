// hooks/useActivePrompt.ts
import { useEffect, useState } from 'react';
import { Task } from '../../base/task/task';
import { TaskPrompt } from '../../base/task/task-prompt';

interface ActivePromptResult {
    task: Task | null;
    prompt: TaskPrompt | null;
}

const getFirstPendingPrompt = (tasks: Task[]): ActivePromptResult => {
    const task = tasks.find(t => t.getPrompt().isPendingUserInput()) || null;
    return {
        task,
        prompt: task?.getPrompt() || null,
    };
};

/**
 * Hook that subscribes to all tasks and returns the first one with a pending prompt.
 * Automatically re-renders when any task's prompt status changes.
 */
export const useActivePrompt = (tasks: Task[]): ActivePromptResult => {
    const [activePrompt, setActivePrompt] = useState<ActivePromptResult>(() => getFirstPendingPrompt(tasks));

    useEffect(() => {
        const updateActivePrompt = () => {
            setActivePrompt(prev => {
                // Only change the active prompt if there is no current active prompt
                if (!prev.task?.getPrompt().getCurrentPrompt())
                    return getFirstPendingPrompt(tasks);
                return prev;
            });
        };

        // Subscribe to all tasks
        const unsubscribers = tasks.map(task =>
            task.subscribe(() => {
                updateActivePrompt();
            })
        );

        // Update immediately in case tasks changed
        updateActivePrompt();

        // Cleanup: unsubscribe from all tasks
        return () => {
            unsubscribers.forEach(unsubscribe => unsubscribe());
        };
    }, [tasks]); // Re-subscribe when tasks array changes

    return activePrompt;
};
