import React, { useEffect } from "react";
import { Box } from "ink";
import { Footer } from "./Footer";
import { Separator } from "./Separator";
import { PromptModal } from "./PromptModal/PromptModal";
import { ImportModal } from "./ImportModal/ImportModal";
import { StartModal } from "./StartModal/StartModal";
import { SettingsModal } from "./SettingsModal/SettingsModal";
import { SetupWizardModal } from "./SetupWizardModal/SetupWizardModal";
import { WelcomeModal } from "./WelcomeModal/WelcomeModal";
import { UpdateModal } from "./UpdateModal/UpdateModal";
import { UpdateInfo } from "#updater/updateChecker";
import { Toolbar, ToolbarButtonHook } from "./Toolbar/Toolbar";
import { ColumnDefinition, TaskListPanel } from "./TaskListPanel/TaskListPanel";
import { SecondaryPanel } from "./SecondaryPanel/SecondaryPanel";
import { ShortcutDispatcher } from "./ShortcutDispatcher";
import { InputRouter } from "./InputRouter";
import { ImportActionsProvider } from "#contexts/ImportActionsContext";
import { FlowOrchestrator } from "#base/flow/flow-orchestrator";
import { Task, TaskAttributes } from "#base/task/task";
import { MusicDownloadTaskAttributes } from "#flows/musicDownloadFlow/types";
import { FlowBase } from "#base/flow/flow-base";
import { useImportFlow } from "./ImportModal/useImportFlow";
import { useStartFlow } from "./StartModal/useStartFlow";
import { startOptionsBridge } from "#base/flow/startOptionsBridge";
import { useTheme } from "#base/themeContext";

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
    updateInfo: UpdateInfo | null;
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
    updateInfo,
}) => {
    const theme = useTheme();
    const { pendingImport, openImportFlow, handleImportConfirm, handleImportCancel } = useImportFlow(currentFlow);
    const { pendingStart, openStartFlow, handleStartConfirm, handleStartCancel } = useStartFlow();

    // Bridge: let plain-TS flow actions open the start-options modal.
    useEffect(() => {
        startOptionsBridge.setOpener(openStartFlow);
        return () => startOptionsBridge.setOpener(null);
    }, [openStartFlow]);

    return (
        <ImportActionsProvider openImportFlow={openImportFlow}>
            {/* ShortcutDispatcher: the single useInput in the app */}
            <ShortcutDispatcher />
            {/* InputRouter: registers global + window-specific shortcuts */}
            <InputRouter tasks={filteredTasks} flow={currentFlow} />

            <Box flexDirection="column" height={terminalHeight} backgroundColor={theme.ui.background}>
                {currentFlow && (
                    <Toolbar
                        buttons={toolbarButtons}
                        width={terminalWidth}
                        flows={orchestrator.getAllFlows()}
                        onFlowChange={setActiveFlowId}
                        flow={currentFlow}
                        orchestrator={orchestrator}
                        updateInfo={updateInfo}
                    />
                )}
                {currentFlow && (
                    <TaskListPanel columns={columns} tasks={filteredTasks} width={terminalWidth} flow={currentFlow} />
                )}
                <SecondaryPanel tasks={filteredTasks} width={terminalWidth} flow={currentFlow} />
                <Separator width={terminalWidth} />
                <Footer />

                {/* Modals rendered above everything else */}

                <PromptModal tasks={tasks} terminalHeight={terminalHeight} terminalWidth={terminalWidth} />

                <ImportModal
                    pendingImport={pendingImport}
                    terminalHeight={terminalHeight}
                    terminalWidth={terminalWidth}
                    onConfirm={handleImportConfirm}
                    onCancel={handleImportCancel}
                />

                <StartModal
                    pendingStart={pendingStart}
                    terminalHeight={terminalHeight}
                    terminalWidth={terminalWidth}
                    onConfirm={handleStartConfirm}
                    onCancel={handleStartCancel}
                />

                <SettingsModal
                    terminalHeight={terminalHeight}
                    terminalWidth={terminalWidth}
                    currentFlow={currentFlow}
                />

                <SetupWizardModal tasks={tasks} terminalHeight={terminalHeight} terminalWidth={terminalWidth} />

                <WelcomeModal terminalHeight={terminalHeight} terminalWidth={terminalWidth} />

                {updateInfo && (
                    <UpdateModal
                        latestVersion={updateInfo.latestVersion}
                        releaseUrl={updateInfo.releaseUrl}
                        terminalHeight={terminalHeight}
                        terminalWidth={terminalWidth}
                    />
                )}
            </Box>
        </ImportActionsProvider>
    );
};
