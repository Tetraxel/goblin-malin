import React, { useCallback, useEffect } from "react";
import { Box } from "ink";
import { Footer } from "./Footer";
import { Separator } from "./Separator";
import { PromptModal } from "./PromptModal/PromptModal";
import { ImportModal } from "./ImportModal/ImportModal";
import { StartModal } from "./StartModal/StartModal";
import { SettingsModal } from "./SettingsModal/SettingsModal";
import { SessionsModal } from "./SessionsModal/SessionsModal";
import { SetupWizardModal } from "./SetupWizardModal/SetupWizardModal";
import { WelcomeModal } from "./WelcomeModal/WelcomeModal";
import { UpdateModal } from "./UpdateModal/UpdateModal";
import { UpdateInfo } from "#updater/updateChecker";
import { Toolbar } from "./Toolbar/Toolbar";
import { ColumnDefinition, TaskListPanel } from "./TaskListPanel/TaskListPanel";
import { SecondaryPanel } from "./SecondaryPanel/SecondaryPanel";
import { ShortcutDispatcher } from "./ShortcutDispatcher";
import { InputRouter } from "./InputRouter";
import { ImportActionsProvider } from "#contexts/ImportActionsContext";
import { Task, TaskAttributes } from "#base/task/task";
import { MusicDownloadTaskAttributes } from "#flows/musicDownloadFlow/types";
import { useImportFlow } from "./ImportModal/useImportFlow";
import { useStartFlow } from "./StartModal/useStartFlow";
import { startOptionsBridge } from "#base/bridges/startOptionsBridge";
import { deleteConfirmBridge, DeleteConfirmRequest } from "#base/bridges/deleteConfirmBridge";
import { ConfirmModal } from "./ConfirmModal/ConfirmModal";
import { useConfirmModal } from "./ConfirmModal/useConfirmModal";
import { useTheme } from "#base/themeContext";

export const AppInner: React.FC<{
    tasks: Task<TaskAttributes>[];
    columns: ColumnDefinition<MusicDownloadTaskAttributes>[];
    terminalHeight: number;
    terminalWidth: number;
    updateInfo: UpdateInfo | null;
}> = ({ tasks, columns, terminalHeight, terminalWidth, updateInfo }) => {
    const theme = useTheme();
    const { pendingImport, openImportFlow, handleImportConfirm, handleImportCancel } = useImportFlow();
    const { pendingStart, openStartFlow, handleStartConfirm, handleStartCancel } = useStartFlow();
    const { pendingConfig, openConfirmModal, handleConfirm, handleCancel } = useConfirmModal();

    const handleDeleteBridgeRequest = useCallback(
        (req: DeleteConfirmRequest) => {
            const count = req.taskCount;
            openConfirmModal({
                title: `Delete ${count === 1 ? "task" : "tasks"}`,
                message: `Remove ${count} ${count === 1 ? "task" : "tasks"} from the queue?`,
                choices: [
                    { label: "Delete", color: theme.status.error },
                    { label: "Cancel", color: theme.text.muted },
                ],
                accentColor: theme.status.error,
                onConfirm: (i) => {
                    if (i === 0) req.apply();
                },
            });
        },
        [openConfirmModal, theme]
    );

    // Bridge: let plain-TS task actions open the start-options modal.
    useEffect(() => {
        startOptionsBridge.setOpener(openStartFlow);
        return () => startOptionsBridge.setOpener(null);
    }, [openStartFlow]);

    // Bridge: let plain-TS task actions open the confirm modal.
    useEffect(() => {
        deleteConfirmBridge.setOpener(handleDeleteBridgeRequest);
        return () => deleteConfirmBridge.setOpener(null);
    }, [handleDeleteBridgeRequest]);

    return (
        <ImportActionsProvider openImportFlow={openImportFlow}>
            {/* ShortcutDispatcher: the single useInput in the app */}
            <ShortcutDispatcher />
            {/* InputRouter: registers global + window-specific shortcuts */}
            <InputRouter tasks={tasks} columns={columns} />

            <Box flexDirection="column" height={terminalHeight} backgroundColor={theme.ui.background}>
                <Toolbar width={terminalWidth} updateInfo={updateInfo} />
                <TaskListPanel columns={columns} tasks={tasks} width={terminalWidth} />
                <SecondaryPanel tasks={tasks} width={terminalWidth} />
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

                <SessionsModal
                    terminalHeight={terminalHeight}
                    terminalWidth={terminalWidth}
                    openConfirmModal={openConfirmModal}
                />

                <SettingsModal
                    terminalHeight={terminalHeight}
                    terminalWidth={terminalWidth}
                    openConfirmModal={openConfirmModal}
                />

                <SetupWizardModal tasks={tasks} terminalHeight={terminalHeight} terminalWidth={terminalWidth} />

                <WelcomeModal terminalHeight={terminalHeight} terminalWidth={terminalWidth} />

                <ConfirmModal
                    pendingConfig={pendingConfig}
                    terminalHeight={terminalHeight}
                    terminalWidth={terminalWidth}
                    onConfirm={handleConfirm}
                    onCancel={handleCancel}
                />

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
