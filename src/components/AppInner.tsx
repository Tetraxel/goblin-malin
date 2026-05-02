import React from "react";
import { Box } from "ink";
import { Footer } from "./Footer";
import { Separator } from "./Separator";
import { PromptModal } from "./PromptModal";
import { ImportModal } from "./ImportModal";
import { Toolbar, ToolbarButtonHook } from "./Toolbar";
import { ColumnDefinition, TaskListPanel } from "./TaskListPanel";
import { ActionBar } from "./ActionBar";
import { SecondaryPanel } from "./SecondaryPanel/SecondaryPanel";
import { InputRouter } from "./InputRouter";
import { ImportActionsProvider } from "../contexts/ImportActionsContext";
import { FlowOrchestrator } from "../base/flow/flow-orchestrator";
import { Task, TaskAttributes } from "../base/task/task";
import { MusicDownloadTaskAttributes } from "../flows/musicDownloadFlow/types";
import { FlowBase } from "../base/flow/flow-base";
import { useImportFlow } from "../hooks/useImportFlow";

export const AppInner: React.FC<{
  tasks: Task<TaskAttributes>[];
  filteredTasks: Task<TaskAttributes>[];
  toolbarButtons: ToolbarButtonHook[];
  columns: ColumnDefinition<MusicDownloadTaskAttributes>[];
  currentFlow: FlowBase | undefined;
  orchestrator: FlowOrchestrator;
  setActiveFlowId: (id: string) => void;
  terminalHeight: number;
  terminalWidth: number;
}> = ({
  tasks,
  filteredTasks,
  toolbarButtons,
  columns,
  currentFlow,
  orchestrator,
  setActiveFlowId,
  terminalHeight,
  terminalWidth,
}) => {
  const {
    pendingImport,
    openImportFlow,
    handleImportConfirm,
    handleImportCancel,
  } = useImportFlow(currentFlow);

  return (
    <ImportActionsProvider openImportFlow={openImportFlow}>
      {/* InputRouter: single root useInput — must be inside FocusProvider */}
      <InputRouter
        tasks={filteredTasks}
        flow={currentFlow}
        openImportFlow={openImportFlow}
      />

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
        <SecondaryPanel
          tasks={filteredTasks}
          width={terminalWidth}
          flow={currentFlow}
        />
        <Separator width={terminalWidth} />
        <Footer />

        {/* Modals rendered above everything else */}

        <PromptModal
          tasks={tasks}
          terminalHeight={terminalHeight}
          terminalWidth={terminalWidth}
        />

        <ImportModal
          pendingImport={pendingImport}
          terminalHeight={terminalHeight}
          terminalWidth={terminalWidth}
          onConfirm={handleImportConfirm}
          onCancel={handleImportCancel}
        />
      </Box>
    </ImportActionsProvider>
  );
};
