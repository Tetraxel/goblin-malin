import React from "react";
import { Box } from "ink";
import { useFocusActions, useFocusChrome, useFocusSecondaryPanel, useFocusTaskList } from "#contexts/FocusContext";
import { useDebouncedValue } from "#hooks/useDebouncedValue";
import { LogPanel } from "./LogPanel";
import { MetadataPanel } from "./MetadataPanel/MetadataPanel";
import { DownloadPanel } from "./DownloadPanel/DownloadPanel";
import { TabBar, type TabDef } from "../TabBar";
import { StemsPanel } from "./StemsPanel/StemsPanel";
import { type SecondaryTab } from "#types/focus";
import { type Task } from "#base/task/task";

/** The tabs below the task list; the brackets show each one's live key (`global.*Tab`). */
const SECONDARY_TABS: TabDef[] = [
    { key: "metadataSources", label: "Metadata Sources", shortcutId: "global.metadataSourcesTab" },
    { key: "downloadSources", label: "Download Sources", shortcutId: "global.downloadSourcesTab" },
    { key: "stems", label: "Stems", shortcutId: "global.stemsTab" },
    { key: "logs", label: "Logs", shortcutId: "global.logsTab" },
];

interface SecondaryPanelProps {
    tasks: Task[];
    width: number;
}

export const SecondaryPanel: React.FC<SecondaryPanelProps> = ({ tasks, width }) => {
    const {
        setCursor,
        setShowDiscoverySources,
        setSourcesInnerFocus,
        setDetailFieldIndex,
        setIsEditingField,
        setSecondaryTab,
        focusSourcesPane,
    } = useFocusActions();
    const { activeWindow, layout, isEditingField } = useFocusChrome();
    const secondaryPanel = useFocusSecondaryPanel();
    const taskList = useFocusTaskList();
    const { subTab } = secondaryPanel;
    const height = layout.secondaryPanelHeight;
    const contentHeight = Math.max(1, height - 1);

    const liveSelectedTask = tasks[taskList.selectedTaskIndex] ?? null;
    // Freeze the heavy detail panels while the task cursor is moving fast (a held arrow key); they catch up
    // ~80ms after the user settles. A single press shows the panel in the same frame as the cursor (`leading`):
    // a trailing-only debounce painted a second full-screen frame 80 ms later for every key, see
    // AUDIT-performance-2.md (PERF2-02).
    const selectedTask = useDebouncedValue(liveSelectedTask, 80, { leading: true });

    // Derived once here so MetadataPanel can stay a memoized, context-free child:
    // every value below is referentially stable while only the task cursor moves,
    // so MetadataPanel bails out entirely during scroll.
    const isMetadataPanelActive = activeWindow === "secondaryPanel" && subTab === "metadataSources";

    return (
        <Box flexDirection="column" height={height} overflow="hidden">
            <TabBar
                width={width}
                tabs={SECONDARY_TABS}
                activeTabKey={subTab}
                onSelect={(key) => setSecondaryTab(key as SecondaryTab)}
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
                    focusSourcesPane={focusSourcesPane}
                    setDetailFieldIndex={setDetailFieldIndex}
                    setIsEditingField={setIsEditingField}
                />
            )}

            {subTab === "downloadSources" && (
                <DownloadPanel selectedTask={selectedTask} width={width} height={contentHeight} />
            )}

            {subTab === "stems" && <StemsPanel selectedTask={selectedTask} width={width} height={contentHeight} />}

            {subTab === "logs" && <LogPanel tasks={tasks} height={contentHeight} width={width} />}
        </Box>
    );
};
