import fs from "fs/promises";
import React, { useEffect, useMemo, useReducer, useState } from "react";
import { Box, useInput, useStdin } from "ink";
import { LogPanel } from "./LogPanel";
import { Footer } from "./Footer";
import { Separator } from "./Separator";
import { PromptModal } from "./PromptModal";
import { Toolbar, ToolbarButtonHook } from "./Toolbar";
import { ColumnDefinition, TaskListPanel } from "./TaskListPanel";
import { useScreenSize } from "../hooks/useScreenSize";
import { useFocusManager } from "../hooks/useFocusManager";
import { FocusProvider } from "../contexts/FocusContext";
import { MusicDownloadFlow } from "../flows/musicDownloadFlow/musicDownloadFlow";
import { FlowOrchestrator } from "../base/flow/flow-orchestrator";
import { Task, TaskAttributes } from "../base/task/task";
import { DownloadTaskAttributes } from "../flows/musicDownloadFlow/types";
import { globalLogger } from "../base/logger/logger";
import { useWhyDidYouUpdate } from "../utils/useWhyDidYouUpdate";

export const App: React.FC = () => {
  globalLogger.info(`--- App render`);

  // Fix: each useInput in the application can trigger a MaxListenersExceededWarning
  const { internal_eventEmitter } = useStdin();
  internal_eventEmitter.setMaxListeners(30);

  const [tasks, setTasks] = useState<Task<TaskAttributes>[]>([]);
  const { height: terminalHeight, width: terminalWidth } = useScreenSize();
  const [activeFlowId, setActiveFlowId] = useState<string | undefined>();
  const [toolbarButtons, setToolbarButtons] = useState<ToolbarButtonHook[]>([]);
  const [columns, setColumns] = useState<
    ColumnDefinition<DownloadTaskAttributes>[]
  >([]);

  const orchestrator = FlowOrchestrator.getInstance();
  const currentFlow = activeFlowId
    ? orchestrator.getFlow(activeFlowId)
    : undefined;

  // Initialize flows on mount
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

    return unsubscribe; // Cleanup subscription on flow change or unmount
  }, [currentFlow?.id]); // Re-subscribe if the currentFlow instance changes

  // Subscribe to orchestrator data changes (tasks)
  useEffect(() => {
    const unsubscribe = orchestrator.subscribe((orchestrator) => {
      globalLogger.info(`orchestrator state changed, updating tasks...`);
      setTasks(orchestrator.getTasks());
    });

    return unsubscribe;
  }, [orchestrator.id]);

  // Filter tasks by active flow
  const filteredTasks = useMemo(
    () => tasks.filter((task) => task.getFlowId() === activeFlowId),
    [tasks, activeFlowId],
  );

  const focusManager = useFocusManager({
    toolbarButtonCount: toolbarButtons.length,
    taskCount: filteredTasks.length,
    taskColumnCount: columns.length,
  });

  // Global shortcuts
  useInput((input, key) => {
    if (key.tab) {
      focusManager.handleTabPress();
      return;
    }

    if (Number(input) >= 0 && Number(input) <= 9) {
      if (currentFlow) {
        focusManager.switchMode(currentFlow, input);
      }
      return;
    }
  });

  useWhyDidYouUpdate("App", {
    tasks, // is the tasks array itself changing?
    activeFlowId,
    columns,
    toolbarButtons,
    currentFlow,
    // also track internal focusManager state if possible
    selectedTaskIndex: focusManager.focusState.taskList.selectedTaskIndex,
    activeWindow: focusManager.focusState.activeWindow,
  });

  return (
    <FocusProvider
      toolbarButtonCount={toolbarButtons.length}
      taskCount={filteredTasks.length}
      taskColumnCount={columns.length}
    >
      <Box flexDirection="column" height={terminalHeight}>
        {currentFlow && (
          <Toolbar
            buttons={toolbarButtons}
            width={terminalWidth}
            flows={orchestrator.getAllFlows()}
            onFlowChange={setActiveFlowId}
            flow={currentFlow}
            orchestrator={orchestrator}
          />
        )}
        {currentFlow && (
          <TaskListPanel
            columns={columns}
            tasks={filteredTasks}
            width={terminalWidth}
            flow={currentFlow}
          />
        )}
        <Separator width={terminalWidth} />
        <LogPanel tasks={filteredTasks} />
        <Separator width={terminalWidth} />
        <Footer />

        {/* Prompt Modal - renders on top when a prompt is active */}
        <PromptModal
          tasks={tasks}
          terminalHeight={terminalHeight}
          terminalWidth={terminalWidth}
        />
      </Box>
    </FocusProvider>
  );
};
