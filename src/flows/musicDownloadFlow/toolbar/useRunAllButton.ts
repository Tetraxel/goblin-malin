import { useEffect, useState } from 'react';
import { useInput } from 'ink';
import { ToolbarButtonHook } from '../../../components/Toolbar';
import { FlowBase } from '../../../base/flow/flow-base';
import { FlowOrchestrator } from '../../../base/flow/flow-orchestrator';
import { Task } from '../../../base/task/task';
import { globalLogger } from '../../../base/logger/logger';


export const useRunAllButton: ToolbarButtonHook<FlowBase> = ({ isSelected, flow, orchestrator }: {
    isSelected: boolean,
    flow: FlowBase,
    orchestrator: FlowOrchestrator
}) => {
    const [pendingTasks, setPendingTasks] = useState<Task[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);

    useInput(
        (input, key) => {
            if (key.return && pendingTasks.length > 0) {
                flow.runAll()
                setIsProcessing(true)
            }
        },
        { isActive: isSelected }
    );

    // Subscribe to orchestrator data changes (tasks)
    useEffect(() => {
        const unsubscribe = orchestrator.subscribe((orchestrator) => {
            const tasks = orchestrator.getTasks()
                .filter((task) => flow.id === task.getFlowId() && task.finishedAt === undefined)
            setPendingTasks(tasks);

            if (isProcessing && tasks.length === 0)
                setIsProcessing(false)
        });

        return unsubscribe;
    }, [orchestrator]);

    if (pendingTasks.length === 0)
        return {
            // enabled: false, // TODO: fix bug that is not moving user input
            icon: "⯈",
            label: `No task to run`,
            color: "gray",
            italic: true,
            enabled: true,
        };

    const taskLabel = pendingTasks.length === 1 ?
        'task' :
        `${pendingTasks.length} tasks`;

    if (isProcessing)
        return {
            icon: "⯀",
            label: `Stop ${taskLabel}`,
            color: "red",
            bold: true,
            enabled: true,
        };

    return {
        icon: "⯈",
        label: `Run ${taskLabel}`,
        color: "green",
        bold: true,
        enabled: true,
    };
}
