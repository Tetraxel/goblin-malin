import React from "react";
import { Box } from "ink";
import { useFocusContext } from "#contexts/FocusContext";
import { LogPanel } from "./LogPanel";
import { MetadataPanel } from "./MetadataPanel/MetadataPanel";
import { DownloadPanel } from "./DownloadPanel/DownloadPanel";
import { TabBar } from "../TabBar";
import { Task } from "#base/task/task";
import { FlowBase } from "#base/flow/flow-base";

interface SecondaryPanelProps {
    tasks: Task[];
    width: number;
    flow: FlowBase | undefined;
}

export const SecondaryPanel: React.FC<SecondaryPanelProps> = ({ tasks, width }) => {
    const { focusState } = useFocusContext();
    const { primaryMode, subTab } = focusState.secondaryPanel;
    const height = focusState.layout.secondaryPanelHeight;
    const contentHeight = Math.max(1, height - 1);

    const selectedTask = tasks[focusState.taskList.selectedTaskIndex] ?? null;

    return (
        <Box flexDirection="column" height={height} overflow="hidden">
            <TabBar
                width={width}
                tabs={[
                    {
                        key: "3",
                        label: primaryMode === "metadata" ? "Metadata Sources" : "Download Sources",
                    },
                    { key: "5", label: "Logs" },
                ]}
                activeTabKey={subTab === "sources" ? "3" : "5"}
            />

            {subTab === "sources" && primaryMode === "metadata" && (
                <MetadataPanel selectedTask={selectedTask} width={width} height={contentHeight} />
            )}

            {subTab === "sources" && primaryMode === "download" && (
                <DownloadPanel selectedTask={selectedTask} width={width} height={contentHeight} />
            )}

            {subTab === "logs" && <LogPanel tasks={tasks} height={contentHeight} />}
        </Box>
    );
};
