import React from "react";
import { Box } from "ink";
import { useFocusContext } from "../../contexts/FocusContext";
import { LogPanel } from "./LogPanel";
import { SourcesPanel } from "./MetadataPanel/SourcesPanel";
import { TabBar } from "../TabBar";
import { Task } from "../../base/task/task";
import { FlowBase } from "../../base/flow/flow-base";

interface SecondaryPanelProps {
  tasks: Task[];
  width: number;
  flow: FlowBase | undefined;
}

export const SecondaryPanel: React.FC<SecondaryPanelProps> = ({
  tasks,
  width,
  flow,
}) => {
  const { focusState } = useFocusContext();
  const { primaryMode, subTab } = focusState.secondaryPanel;
  const height = focusState.layout.secondaryPanelHeight;
  const contentHeight = Math.max(1, height - 1); // subtract tab bar row

  const selectedTask = tasks[focusState.taskList.selectedTaskIndex] ?? null;

  return (
    <Box flexDirection="column" height={height} overflow="hidden">
      <TabBar
        width={width}
        tabs={[
          {
            key: "3",
            label:
              primaryMode === "metadata"
                ? "Metadata Sources"
                : "Download Sources",
          },
          { key: "4", label: "Logs" },
        ]}
        activeTabKey={subTab === "sources" ? "3" : "4"}
      />

      {subTab === "sources" && (
        <SourcesPanel
          mode={primaryMode}
          selectedTask={selectedTask}
          width={width}
          height={contentHeight}
        />
      )}

      {/* Always mounted so log history is preserved when switching tabs */}
      {subTab === "logs" && (
        <LogPanel tasks={tasks} width={width} height={contentHeight} />
      )}
    </Box>
  );
};
