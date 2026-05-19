import { useEffect, useState } from "react";
import { Task } from "#base/task/task";
import { globalLogger } from "#base/logger/logger";

/**
 * Hook that subscribes to a Task instance and returns its current state.
 * Automatically re-renders the component when the task changes.
 */
export const useTask = <TAttributes>(task: Task<TAttributes>) => {
    // Store a snapshot of the task's current state
    const [taskSnapshot, setTaskSnapshot] = useState(() => task.get());

    useEffect(() => {
        globalLogger.info(`Subscribing to task ${task.getId()} updates...`);
        // Subscribe to task changes
        const unsubscribe = task.subscribe((updatedTask) => {
            globalLogger.info(`Task ${updatedTask.id} updated, updating snapshot...`);
            // Update the snapshot, which triggers a re-render
            setTaskSnapshot(updatedTask.get());
        });

        // Cleanup: unsubscribe when component unmounts or task changes
        return unsubscribe;
    }, [task]); // Re-subscribe if the task instance changes

    return taskSnapshot;
    // return taskSnapshot as ReturnType<Task<Attributes>['get']>;
};
