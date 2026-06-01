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
    const { subTab } = focusState.secondaryPanel;
    const height = focusState.layout.secondaryPanelHeight;
    const contentHeight = Math.max(1, height - 1);

    const selectedTask = tasks[focusState.taskList.selectedTaskIndex] ?? null;

    const activeTabKey = subTab === "metadataSources" ? "3" : subTab === "downloadSources" ? "4" : "5";

    return (
        <Box flexDirection="column" height={height} overflow="hidden">
            <TabBar
                width={width}
                tabs={[
                    { key: "3", label: "Metadata Sources" },
                    { key: "4", label: "Download Sources" },
                    { key: "5", label: "Logs" },
                ]}
                activeTabKey={activeTabKey}
            />

            {subTab === "metadataSources" && (
                <MetadataPanel selectedTask={selectedTask} width={width} height={contentHeight} />
            )}

            {subTab === "downloadSources" && (
                <DownloadPanel selectedTask={selectedTask} width={width} height={contentHeight} />
            )}

            {subTab === "logs" && <LogPanel tasks={tasks} height={contentHeight} />}
        </Box>
    );
};
