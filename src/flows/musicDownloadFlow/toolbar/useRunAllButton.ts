import { useEffect, useState } from "react";
import { ToolbarButtonHook } from "#components/Toolbar/Toolbar";
import { FlowBase } from "#base/flow/flow-base";
import { FlowOrchestrator } from "#base/flow/flow-orchestrator";
import { Task } from "#base/task/task";
import { StatusType } from "#base/task/task-status";
import { useTheme } from "#base/themeContext";
import { useFocusTaskList } from "#contexts/FocusContext";

export const useRunAllButton: ToolbarButtonHook<FlowBase> = ({
    flow,
    orchestrator,
}: {
    isSelected: boolean;
    flow: FlowBase;
    orchestrator: FlowOrchestrator;
}) => {
    const theme = useTheme();
    const taskList = useFocusTaskList();
    const selectedIds = taskList.selectedTaskIds;

    const [runnableTasks, setRunnableTasks] = useState<Task[]>([]);
    const [batchCount, setBatchCount] = useState(0);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isStopping, setIsStopping] = useState(false);
    // Tracks whether the current processing batch was started from "selected" mode
    const [runMode, setRunMode] = useState<"all" | "selected">("all");

    useEffect(() => {
        const unsubscribe = orchestrator.subscribe((o) => {
            const flowTasks = o.getTasks().filter((t) => t.getFlowId() === flow.id);

            // Tasks available to run (pending or stopped)
            const runnable = flowTasks.filter(
                (task) => task.getAttributes()?.state === "pending" || task.getAttributes()?.state === "stopped"
            );
            setRunnableTasks(runnable);

            // Tasks actively in the current batch: running or queued for this batch
            const batch = flowTasks.filter(
                (task) => task.running || task.getStatus().get().type === StatusType.Pending
            );
            setBatchCount(batch.length);

            setIsProcessing(o.isProcessing());
            setIsStopping(o.isStopping());

            // Reset run mode once processing is fully done
            if (!o.isProcessing()) setRunMode("all");
        });

        return unsubscribe;
    }, [orchestrator, flow.id]);

    // Selected tasks that are actually in the runnable pool (or were already run — runSelected resets them)
    const selectedRunnableCount =
        selectedIds.size > 0
            ? orchestrator.getTasks().filter((t) => selectedIds.has(t.getId()) && t.getFlowId() === flow.id).length
            : 0;

    const useSelectedMode = selectedIds.size > 0 && selectedRunnableCount > 0;
    const activeCount = useSelectedMode ? selectedRunnableCount : runnableTasks.length;

    if (activeCount === 0 && !isProcessing)
        return {
            icon: "⯈",
            label: `No task to run`,
            color: theme.action.neutral,
            italic: true,
            enabled: true,
        };

    const taskLabel = (n: number, qualifier?: string) => {
        const desc = qualifier ? `${n} ${qualifier}` : `${n}`;
        return n === 1 ? `${desc} task` : `${desc} tasks`;
    };

    if (isProcessing) {
        const qualifier = runMode === "selected" ? "selected" : undefined;
        if (isStopping) {
            return {
                inProgress: true,
                label: `Stop ${taskLabel(batchCount, qualifier)}`,
                color: theme.action.destructive,
                bold: true,
                enabled: true,
                // No onPress — button is visible but unclickable while draining
            };
        }
        return {
            icon: "⯀",
            label: `Stop ${taskLabel(batchCount, qualifier)}`,
            color: theme.action.destructive,
            bold: true,
            enabled: true,
            onPress: () => flow.stopAll(),
        };
    }

    if (useSelectedMode) {
        return {
            icon: "⯈",
            label: `Run ${taskLabel(selectedRunnableCount, "selected")}`,
            color: theme.status.success,
            bold: true,
            enabled: true,
            onPress: () => {
                setRunMode("selected");
                flow.runSelected(selectedIds);
            },
        };
    }

    return {
        icon: "⯈",
        label: `Run ${taskLabel(activeCount)}`,
        color: theme.status.success,
        bold: true,
        enabled: true,
        onPress: () => {
            setRunMode("all");
            flow.runAll();
        },
    };
};
