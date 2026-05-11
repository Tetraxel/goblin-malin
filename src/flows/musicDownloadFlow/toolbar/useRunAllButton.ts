import { useEffect, useState } from 'react';
import { ToolbarButtonHook } from '../../../components/Toolbar';
import { FlowBase } from '../../../base/flow/flow-base';
import { FlowOrchestrator } from '../../../base/flow/flow-orchestrator';
import { Task } from '../../../base/task/task';
import { useTheme } from '../../../base/themeContext';

export const useRunAllButton: ToolbarButtonHook<FlowBase> = ({ flow, orchestrator }: {
    isSelected: boolean,
    flow: FlowBase,
    orchestrator: FlowOrchestrator,
}) => {
    const theme = useTheme();
    const [pendingTasks, setPendingTasks] = useState<Task[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);

    useEffect(() => {
        const unsubscribe = orchestrator.subscribe((orchestrator) => {
            const tasks = orchestrator.getTasks()
                .filter((task) => flow.id === task.getFlowId() && task.finishedAt === undefined);
            setPendingTasks(tasks);

            if (isProcessing && tasks.length === 0)
                setIsProcessing(false);
        });

        return unsubscribe;
    }, [orchestrator]);

    if (pendingTasks.length === 0)
        return {
            icon: "⯈",
            label: `No task to run`,
            color: theme.action.neutral,
            italic: true,
            enabled: true,
        };

    const taskLabel = pendingTasks.length === 1 ? 'task' : `${pendingTasks.length} tasks`;

    if (isProcessing)
        return {
            icon: "⯀",
            label: `Stop ${taskLabel}`,
            color: theme.action.destructive,
            bold: true,
            enabled: true,
        };

    return {
        icon: "⯈",
        label: `Run ${taskLabel}`,
        color: theme.status.success,
        bold: true,
        enabled: true,
        onPress: () => { flow.runAll(); setIsProcessing(true); },
    };
};
