import React, { useEffect, useMemo, useState } from "react";
import { Box, Text } from "ink";
import { LogPanel } from "./LogPanel";
import { Footer } from "./Footer";
import { Separator } from "./Separator";
import { PromptModal } from "./PromptModal";
import { Toolbar, ToolbarButtonHook } from "./Toolbar";
import { ColumnDefinition, TaskListPanel } from "./TaskListPanel";
import { ActionBar } from "./ActionBar";
import { InputRouter } from "./InputRouter";
import { useScreenSize } from "../hooks/useScreenSize";
import { FocusProvider } from "../contexts/FocusContext";
import { ToolbarActionsProvider } from "../contexts/ToolbarActionsContext";
import { MusicDownloadFlow } from "../flows/musicDownloadFlow/musicDownloadFlow";
import { FlowOrchestrator } from "../base/flow/flow-orchestrator";
import { Task, TaskAttributes } from "../base/task/task";
import { MusicDownloadTaskAttributes } from "../flows/musicDownloadFlow/types";
import { globalLogger } from "../base/logger/logger";
import soundPlay from "sound-play";
import BigText from "ink-big-text";

export const App: React.FC = () => {
  globalLogger.info(`--- App render`);
  useEffect(() => {
    soundPlay.play(
      "C:\\Users\\axel7\\Documents\\Github\\goblin-malin\\init.wav",
      0.5,
    );
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
        {/* InputRouter: single root useInput — must be inside FocusProvider */}
        <InputRouter tasks={filteredTasks} flow={currentFlow} />

        {/* <Text color="gray">██</Text>
      <Text color="cyan">██</Text>
      <Text color="cyanBright">██</Text>
      <Text color="red">██</Text>
      <Text color="redBright">██</Text>
      <Text color="green">██</Text>
      <Text color="greenBright">██</Text>
      <BigText text="Goblin Malin" /> */}

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
          <ActionBar tasks={filteredTasks} flow={currentFlow} />
          <Separator width={terminalWidth} />
          <LogPanel tasks={filteredTasks} />
          <Separator width={terminalWidth} />
          <Footer />

          <PromptModal
            tasks={tasks}
            terminalHeight={terminalHeight}
            terminalWidth={terminalWidth}
          />
        </Box>
      </ToolbarActionsProvider>
    </FocusProvider>
  );
};
