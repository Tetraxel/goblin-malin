import React, { useEffect, useMemo, useState } from "react";
import { ToolbarButtonHook } from "./Toolbar";
import { ColumnDefinition } from "./TaskListPanel";
import { useScreenSize } from "../hooks/useScreenSize";
import { FocusProvider } from "../contexts/FocusContext";
import { ToolbarActionsProvider } from "../contexts/ToolbarActionsContext";
import { MusicDownloadFlow } from "../flows/musicDownloadFlow/musicDownloadFlow";
import { FlowOrchestrator } from "../base/flow/flow-orchestrator";
import { Task, TaskAttributes } from "../base/task/task";
import { MusicDownloadTaskAttributes } from "../flows/musicDownloadFlow/types";
import { globalLogger } from "../base/logger/logger";
import soundPlay from "sound-play";
import { fileURLToPath } from "url";
import path from "path";
import { AppInner } from "./AppInner";

export const App: React.FC = () => {
  globalLogger.info(`--- App render`);
  useEffect(() => {
    const initWav = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../init.wav",
    );
    soundPlay.play(initWav, 0.5);
  }, []);

  const [tasks, setTasks] = useState<Task<TaskAttributes>[]>([]);
  const { height: terminalHeight, width: terminalWidth } = useScreenSize();
  const [activeFlowId, setActiveFlowId] = useState<string | undefined>();
  const [toolbarButtons, setToolbarButtons] = useState<ToolbarButtonHook[]>([]);
  const [columns, setColumns] = useState<
    ColumnDefinition<MusicDownloadTaskAttributes>[]
  >([]);
  const orchestrator = FlowOrchestrator.getInstance();
  const currentFlow = activeFlowId
    ? orchestrator.getFlow(activeFlowId)
    : undefined;

  useEffect(() => {
    orchestrator.registerFlow(MusicDownloadFlow, true);
    setActiveFlowId(orchestrator.getEnabledFlows()?.[0].id);
  }, []);

  // [!] This is important to allow dynamic updates of buttons and columns when the flow changes
  useEffect(() => {
    if (!currentFlow) return;
    globalLogger.debug(`Active flow changed: ${currentFlow?.displayName}`);
    // Subscribe to currentFlow changes to update buttons and columns dynamically
    const unsubscribe = currentFlow.subscribe((updatedFlow) => {
      globalLogger.debug(`flow state changed, updating UI...`);
      setToolbarButtons(currentFlow.getToolbarButtons() ?? []);
      setColumns(currentFlow.getColumns() ?? []);
    });
    return unsubscribe;
  }, [currentFlow?.id]);

  useEffect(() => {
    const unsubscribe = orchestrator.subscribe((orchestrator) => {
      globalLogger.info(`orchestrator state changed, updating tasks...`);
      setTasks(orchestrator.getTasks());
    });
    return unsubscribe;
  }, [orchestrator.id]);

  const filteredTasks = useMemo(
    () => tasks.filter((task) => task.getFlowId() === activeFlowId),
    [tasks, activeFlowId],
  );

  return (
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
  );
};
