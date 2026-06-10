import React, { useState, useEffect, useCallback } from "react";
import { Box } from "ink";
import { Footer } from "./Footer";
import { Separator } from "./Separator";
import { PromptModal } from "./PromptModal/PromptModal";
import { ImportModal } from "./ImportModal/ImportModal";
import { SettingsModal } from "./SettingsModal/SettingsModal";
import { SetupWizardModal } from "./SetupWizardModal/SetupWizardModal";
import { WelcomeModal } from "./WelcomeModal/WelcomeModal";
import { UpdateModal } from "./UpdateModal/UpdateModal";
import { checkForUpdate, UpdateInfo } from "../updater/updateChecker";
import { SettingsStore } from "#settings/settingsStore";
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
import { useTheme } from "#base/themeContext";
import { useFocusContext } from "#contexts/FocusContext";
import { globalLogger } from "#base/logger/logger";

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
    const theme = useTheme();
    const { pendingImport, openImportFlow, handleImportConfirm, handleImportCancel } = useImportFlow(currentFlow);
    const { openUpdateModal } = useFocusContext();

    const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
    const [pendingUpdate, setPendingUpdate] = useState<UpdateInfo | null>(null);

    const isOrchestratorIdle = useCallback((orch: FlowOrchestrator) => orch.getTasksInProgress().length === 0, []);

    useEffect(() => {
        const settings = SettingsStore.getInstance().getAppSettings();
        if (!settings.general.checkForUpdates) return;
        checkForUpdate().then((info) => {
            if (!info?.hasUpdate) return;

            if (isOrchestratorIdle(orchestrator)) {
                setUpdateInfo(info);
                openUpdateModal();
            } else {
                setPendingUpdate(info);
            }
        });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!pendingUpdate) return;
        return orchestrator.subscribe((orch) => {
            if (isOrchestratorIdle(orch)) {
                setUpdateInfo(pendingUpdate);
                setPendingUpdate(null);
                openUpdateModal();
            }
        });
    }, [pendingUpdate, orchestrator, openUpdateModal, isOrchestratorIdle]);

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
                        downloadUrl={updateInfo.downloadUrl}
                        terminalHeight={terminalHeight}
                        terminalWidth={terminalWidth}
                    />
                )}
            </Box>
        </ImportActionsProvider>
    );
};
