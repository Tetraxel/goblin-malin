import React, { useCallback, useEffect } from "react";
import { Box } from "ink";
import { Footer } from "./Footer";
import { Separator } from "./Separator";
import { PromptModal } from "./PromptModal/PromptModal";
import { ImportModal } from "./ImportModal/ImportModal";
import { StartModal } from "./StartModal/StartModal";
import { SettingsModal } from "./SettingsModal/SettingsModal";
import { SessionsModal } from "./SessionsModal/SessionsModal";
import { ArchiveModal } from "./ArchiveModal/ArchiveModal";
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
import { consentBridge, ConsentRequest } from "#base/bridges/consentBridge";
import { collectionHintBridge, CollectionHintRequest } from "#base/bridges/collectionHintBridge";
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
    const { pendingConfig, openConfirmModal, handleConfirm, handleCancel } = useConfirmModal();
    const { pendingImport, openImportFlow, handleImportConfirm, handleImportCancel } = useImportFlow(openConfirmModal);
    const { pendingStart, openStartFlow, handleStartConfirm, handleStartCancel } = useStartFlow();

    const handleDeleteBridgeRequest = useCallback(
        (req: DeleteConfirmRequest) => {
            const count = req.taskCount;
            const noun = count === 1 ? "task" : "tasks";
            openConfirmModal({
                title: `Remove ${noun}`,
                message: `Archive ${count} ${noun} to keep metadata and sources, or delete for good?`,
                choices: [
                    { label: "Archive", color: theme.action.primary },
                    { label: "Delete", color: theme.status.error },
                    { label: "Cancel", color: theme.text.muted },
                ],
                accentColor: theme.action.primary,
                onConfirm: (i) => {
                    if (i === 0) req.archive();
                    else if (i === 1) req.apply();
                },
            });
        },
        [openConfirmModal, theme]
    );

    // Bridge: let discovery providers ask the user's permission before their first use.
    const handleConsentRequest = useCallback(
        (req: ConsentRequest) => {
            openConfirmModal({
                title: req.title,
                message: req.message,
                choices: [
                    { label: "Allow", color: theme.status.success },
                    { label: "Don't allow", color: theme.status.error },
                ],
                accentColor: req.color,
                onConfirm: (i) => (i === 0 ? req.allow() : req.deny()),
                onCancel: req.dismiss,
            });
        },
        [openConfirmModal, theme]
    );

    // Bridge: let collection tasks explain why a playlist can't be read (e.g. it is private).
    const handleCollectionHint = useCallback(
        (req: CollectionHintRequest) => {
            openConfirmModal({
                title: `Can't read "${req.label}"`,
                message: req.hint,
                choices: [
                    { label: "OK", color: theme.action.primary },
                    { label: "Don't show again", color: theme.text.muted },
                ],
                accentColor: theme.status.warning,
                onConfirm: (i) => {
                    if (i === 1) req.muteForever();
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

    useEffect(() => {
        collectionHintBridge.setOpener(handleCollectionHint);
        return () => collectionHintBridge.setOpener(null);
    }, [handleCollectionHint]);

    useEffect(() => {
        consentBridge.setOpener(handleConsentRequest);
        return () => consentBridge.setOpener(null);
    }, [handleConsentRequest]);

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

                <ArchiveModal
                    tasks={tasks}
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
