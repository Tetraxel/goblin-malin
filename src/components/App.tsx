import fs from "fs/promises";
import React, { useEffect, useReducer, useState } from "react";
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
import { DownloadTaskAttributes } from "../flows/musicDownloadFlow/utils/downloadTask";
import { MusicDownloadFlow } from "../flows/musicDownloadFlow/musicDownloadFlow";
import { FlowOrchestrator } from "../base/flow/flow-orchestrator";
import { Task, TaskAttributes } from "../base/task/task";

export const App: React.FC = () => {
  // Fix: each useInput in the application can trigger a MaxListenersExceededWarning
  const { internal_eventEmitter } = useStdin();
  internal_eventEmitter.setMaxListeners(20);

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

  // Keep buttons in sync when active flow changes
  useEffect(() => {
    setToolbarButtons(currentFlow?.getToolbarButtons() ?? []);
    setColumns(currentFlow?.getColumns() ?? []);
  }, [currentFlow]);

  // Subscribe to orchestrator data changes (tasks)
  useEffect(() => {
    const unsubscribe = orchestrator.subscribe((orchestrator) => {
      setTasks(orchestrator.getTasks());
    });

    return unsubscribe;
  }, [orchestrator]);

  // Filter tasks by active flow
  const filteredTasks = tasks.filter(
    (task) => task.getFlowId() === activeFlowId
  );

  const focusManager = useFocusManager({
    toolbarButtonCount: toolbarButtons.length,
    taskCount: filteredTasks.length,
    taskColumnCount: columns.length,
    logCount: 0, // TODO: Move logs to <App/> with filters (logs.length)
  });

  // Global shortcuts
  useInput((input, key) => {
    if (key.tab) {
      focusManager.handleTabPress();
      return;
    }
  });

  return (
    <FocusProvider value={focusManager}>
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
