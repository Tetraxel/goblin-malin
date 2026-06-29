import React from "react";
import { Box } from "ink";
import { useFocusActions, useFocusChrome, useFocusSecondaryPanel, useFocusTaskList } from "#contexts/FocusContext";
import { useDebouncedValue } from "#hooks/useDebouncedValue";
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
    const { setCursor, setShowDiscoverySources, setSourcesInnerFocus, setDetailFieldIndex, setIsEditingField } =
        useFocusActions();
    const { activeWindow, layout, isEditingField } = useFocusChrome();
    const secondaryPanel = useFocusSecondaryPanel();
    const taskList = useFocusTaskList();
    const { subTab } = secondaryPanel;
    const height = layout.secondaryPanelHeight;
    const contentHeight = Math.max(1, height - 1);

    const liveSelectedTask = tasks[taskList.selectedTaskIndex] ?? null;
    // Freeze the heavy detail panels while the task cursor is moving; they catch up
    // ~80ms after the user settles. This keeps task-list scrolling smooth — the
    // secondary panel is the dominant per-keystroke render cost otherwise.
    const selectedTask = useDebouncedValue(liveSelectedTask, 80);

    const activeTabKey = subTab === "metadataSources" ? "3" : subTab === "downloadSources" ? "4" : "5";

    // Derived once here so MetadataPanel can stay a memoized, context-free child:
    // every value below is referentially stable while only the task cursor moves,
    // so MetadataPanel bails out entirely during scroll.
    const isMetadataPanelActive = activeWindow === "secondaryPanel" && subTab === "metadataSources";

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
                <MetadataPanel
                    selectedTask={selectedTask}
                    width={width}
                    height={contentHeight}
                    sourcesPanel={secondaryPanel.sourcesPanel}
                    isPanelActive={isMetadataPanelActive}
                    isEditingField={isEditingField}
                    setCursor={setCursor}
                    setShowDiscoverySources={setShowDiscoverySources}
                    setSourcesInnerFocus={setSourcesInnerFocus}
                    setDetailFieldIndex={setDetailFieldIndex}
                    setIsEditingField={setIsEditingField}
                />
            )}

            {subTab === "downloadSources" && (
                <DownloadPanel selectedTask={selectedTask} width={width} height={contentHeight} />
            )}

            {subTab === "logs" && <LogPanel tasks={tasks} height={contentHeight} width={width} />}
        </Box>
    );
};
