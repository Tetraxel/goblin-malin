import React, { useEffect, useMemo, useState } from "react";
import { ToolbarButtonHook } from "./Toolbar/Toolbar";
import { ColumnDefinition } from "./TaskListPanel/TaskListPanel";
import { useScreenSize } from "../hooks/useScreenSize";
import { FocusProvider } from "../contexts/FocusContext";
import { ToolbarActionsProvider } from "../contexts/ToolbarActionsContext";
import { ThemeProvider } from "../base/themeContext";
import { MusicDownloadFlow } from "../flows/musicDownloadFlow/musicDownloadFlow";
import { FlowOrchestrator } from "../base/flow/flow-orchestrator";
import { Task, TaskAttributes } from "../base/task/task";
import { MusicDownloadTaskAttributes } from "../flows/musicDownloadFlow/types";
import { globalLogger } from "../base/logger/logger";
import { getInstance } from "../utils/mpvPlayer";
import { getAssetPath } from "../utils/appPaths";
import { AppInner } from "./AppInner";

export const App: React.FC = () => {
  useEffect(() => {
    const initWav = getAssetPath("sounds", "init.wav");
    const player = getInstance();
    player
      .setVolume(50)
      .then(() => player.play(initWav))
      .catch(() => {});
  }, []);

  const [tasks, setTasks] = useState<Task<TaskAttributes>[]>([]);
  const { height: terminalHeight, width: terminalWidth } = useScreenSize();
  const orchestrator = FlowOrchestrator.getInstance();
  const [activeFlowId, setActiveFlowId] = useState<string | undefined>(() => {
    orchestrator.registerFlow(MusicDownloadFlow, true);
    return orchestrator.getEnabledFlows()?.[0].id;
  });
  const [toolbarButtons, setToolbarButtons] = useState<ToolbarButtonHook[]>([]);
  const [columns, setColumns] = useState<
    ColumnDefinition<MusicDownloadTaskAttributes>[]
  >([]);
  const currentFlow = activeFlowId
    ? orchestrator.getFlow(activeFlowId)
    : undefined;

  // [!] This is important to allow dynamic updates of buttons and columns when the flow changes
  useEffect(() => {
    if (!currentFlow) return;
    globalLogger.debug(`Active flow changed: ${currentFlow?.displayName}`);
    // Subscribe to currentFlow changes to update buttons and columns dynamically
    const unsubscribe = currentFlow.subscribe((_updatedFlow) => {
      globalLogger.debug(`flow state changed, updating UI...`);
      setToolbarButtons(currentFlow.getToolbarButtons() ?? []);
      setColumns(currentFlow.getColumns() ?? []);
    });
    return unsubscribe;
  }, [currentFlow, currentFlow?.id]);

  useEffect(() => {
    const unsubscribe = orchestrator.subscribe((orchestrator) => {
      setTasks(orchestrator.getTasks());
    });
    return unsubscribe;
  }, [orchestrator, orchestrator.id]);

  const filteredTasks = useMemo(
    () => tasks.filter((task) => task.getFlowId() === activeFlowId),
    [tasks, activeFlowId],
  );

  return (
    <ThemeProvider>
      <FocusProvider
        toolbarButtonCount={toolbarButtons.length}
        taskCount={filteredTasks.length}
        taskColumnCount={columns.length}
      >
        <ToolbarActionsProvider>
          <AppInner
            tasks={tasks}
            filteredTasks={filteredTasks}
            toolbarButtons={toolbarButtons}
            columns={columns}
            currentFlow={currentFlow}
            orchestrator={orchestrator}
            setActiveFlowId={setActiveFlowId}
            terminalHeight={terminalHeight}
            terminalWidth={terminalWidth}
          />
        </ToolbarActionsProvider>
      </FocusProvider>
    </ThemeProvider>
  );
};
