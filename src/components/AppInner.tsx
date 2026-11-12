import React, { useCallback, useEffect, useSyncExternalStore } from "react";
import { Box } from "ink";
import { Footer } from "./Footer";
import { TerminalTooSmall } from "./TerminalTooSmall";
import { isTerminalTooSmall } from "#utils/terminalSize";
import { introState } from "#utils/introState";
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
import { type UpdateInfo } from "#updater/updateChecker";
import { Toolbar } from "./Toolbar/Toolbar";
import { type ColumnDefinition, TaskListPanel } from "./TaskListPanel/TaskListPanel";
import { SecondaryPanel } from "./SecondaryPanel/SecondaryPanel";
import { ShortcutDispatcher } from "./ShortcutDispatcher";
import { InputRouter } from "./InputRouter";
import { ImportActionsProvider } from "#contexts/ImportActionsContext";
import { type Task, type TaskAttributes } from "#base/task/task";
import { type MusicDownloadTaskAttributes } from "#flows/musicDownloadFlow/types";
import { useImportFlow } from "./ImportModal/useImportFlow";
import { useStartFlow } from "./StartModal/useStartFlow";
import { startOptionsBridge } from "#base/bridges/startOptionsBridge";
import { deleteConfirmBridge, type DeleteConfirmRequest } from "#base/bridges/deleteConfirmBridge";
import { consentBridge, type ConsentRequest } from "#base/bridges/consentBridge";
import { collectionHintBridge, type CollectionHintRequest } from "#base/bridges/collectionHintBridge";
import { overwriteConfirmBridge, type OverwriteConfirmRequest } from "#base/bridges/overwriteConfirmBridge";
import { binaryAlertBridge, type BinaryAlertRequest } from "#base/bridges/binaryAlertBridge";
import { dataFileNoticeBridge, type DataFileNotice } from "#base/bridges/dataFileNoticeBridge";
import { dialogBridge, type ConfirmDialog, type DialogTone } from "#base/bridges/dialogBridge";
import { ConfirmModal } from "./ConfirmModal/ConfirmModal";
import { ListDialogModal } from "./ListDialogModal/ListDialogModal";
import { useListDialog } from "./ListDialogModal/useListDialog";
import { ClosingModal } from "./ClosingModal/ClosingModal";
import { TempCleanupModal } from "./TempCleanupModal/TempCleanupModal";
import { useConfirmModal } from "./ConfirmModal/useConfirmModal";
import { useTheme } from "#base/themeContext";
import { useQuitShortcut } from "#hooks/useQuitShortcut";

export const AppInner: React.FC<{
    tasks: Task<TaskAttributes>[];
    columns: ColumnDefinition<MusicDownloadTaskAttributes>[];
    terminalHeight: number;
    terminalWidth: number;
    updateInfo: UpdateInfo | null;
}> = ({ tasks, columns, terminalHeight, terminalWidth, updateInfo }) => {
    const theme = useTheme();
    const { pendingConfig, openConfirmModal, openConfirmModalWhenFree, handleConfirm, handleCancel } =
        useConfirmModal();
    // Notices raised by background work wait for the welcome intro to close: they would land in its animation.
    const introOpen = useSyncExternalStore(introState.subscribe, introState.isOpen);
    const tooSmall = isTerminalTooSmall(terminalWidth, terminalHeight);
    useQuitShortcut(openConfirmModal, pendingConfig, !tooSmall);
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

    // Bridge: let a save ask before it replaces a file that isn't its own. "Keep" comes first: it is the
    // choice the dialog starts on, so a stray Enter never destroys a file.
    const handleOverwriteRequest = useCallback(
        (req: OverwriteConfirmRequest) => {
            openConfirmModal({
                title: "Replace existing file?",
                message: `A different file already has this name:
${req.filePath}
Replacing it cannot be undone.`,
                choices: [
                    { label: "Keep it", color: theme.action.primary },
                    { label: "Replace", color: theme.status.error },
                ],
                accentColor: theme.status.warning,
                onConfirm: (i) => (i === 1 ? req.replace() : req.cancel()),
                onCancel: req.cancel,
            });
        },
        [openConfirmModal, theme]
    );

    // Bridge: tell the user a tool (ffmpeg, yt-dlp…) could not be found or downloaded. This comes from background
    // work at any moment, so it waits for a free dialog slot instead of replacing a dialog the user is answering.
    const handleBinaryAlert = useCallback(
        (req: BinaryAlertRequest) => {
            openConfirmModalWhenFree({
                title: `Can't set up ${req.binary}`,
                message: `${req.reason}

${req.impact}
Check your internet connection, then try again.`,
                choices: [{ label: "OK", color: theme.action.primary }],
                accentColor: theme.status.error,
                onConfirm: () => {},
            });
        },
        [openConfirmModalWhenFree, theme]
    );

    // Bridge: tell the user a data file (sessions, settings) was damaged, repaired or set aside. These are raised
    // while the app boots, so the bridge holds them until this handler is attached.
    const handleDataFileNotice = useCallback(
        (notice: DataFileNotice) => {
            openConfirmModalWhenFree({
                title: notice.title,
                message: notice.message,
                choices: [{ label: "OK", color: theme.action.primary }],
                accentColor: theme.status.warning,
                onConfirm: () => {},
            });
        },
        [openConfirmModalWhenFree, theme]
    );

    // Bridge: let plain-TS flows ask a question and wait for the answer (dialogBridge.confirm / .choose). These
    // are answers to something the user just asked for, but a flow may still be waiting on a dialog the user is
    // answering, so a confirm waits for a free slot rather than replacing it.
    const { pending: pendingList, open: openListDialog, answer: answerListDialog } = useListDialog();
    const handleDialogConfirm = useCallback(
        (dialog: ConfirmDialog, resolve: (index: number | null) => void) => {
            const colors: Record<DialogTone, string> = {
                primary: theme.action.primary,
                danger: theme.status.error,
                muted: theme.text.muted,
                success: theme.status.success,
            };
            openConfirmModalWhenFree({
                title: dialog.title,
                message: dialog.message,
                choices: dialog.choices.map((c) => ({ label: c.label, color: colors[c.tone] })),
                accentColor: dialog.accent ?? theme.action.primary,
                onConfirm: (i) => resolve(i),
                onCancel: () => resolve(null),
            });
        },
        [openConfirmModalWhenFree, theme]
    );

    useEffect(() => {
        dialogBridge.setConfirmOpener(handleDialogConfirm);
        return () => dialogBridge.setConfirmOpener(null);
    }, [handleDialogConfirm]);

    useEffect(() => {
        dialogBridge.setListOpener(openListDialog);
        return () => dialogBridge.setListOpener(null);
    }, [openListDialog]);

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
        overwriteConfirmBridge.setOpener(handleOverwriteRequest);
        return () => overwriteConfirmBridge.setOpener(null);
    }, [handleOverwriteRequest]);

    useEffect(() => {
        consentBridge.setOpener(handleConsentRequest);
        return () => consentBridge.setOpener(null);
    }, [handleConsentRequest]);

    useEffect(() => {
        binaryAlertBridge.setOpener(handleBinaryAlert);
        return () => binaryAlertBridge.setOpener(null);
    }, [handleBinaryAlert]);

    useEffect(() => {
        dataFileNoticeBridge.setOpener(handleDataFileNotice);
        return () => dataFileNoticeBridge.setOpener(null);
    }, [handleDataFileNotice]);

    return (
        <ImportActionsProvider openImportFlow={openImportFlow}>
            {/* ShortcutDispatcher: the single useInput in the app */}
            <ShortcutDispatcher />
            {/* InputRouter: registers global + window-specific shortcuts */}
            <InputRouter tasks={tasks} columns={columns} />

            {/* The dispatcher, router and every hook above stay mounted, so state and shortcuts (quit) survive a resize. */}
            {tooSmall ? (
                <TerminalTooSmall width={terminalWidth} height={terminalHeight} />
            ) : (
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
                        pendingConfig={introOpen ? null : pendingConfig}
                        terminalHeight={terminalHeight}
                        terminalWidth={terminalWidth}
                        onConfirm={handleConfirm}
                        onCancel={handleCancel}
                    />

                    <ListDialogModal
                        pending={pendingList}
                        terminalHeight={terminalHeight}
                        terminalWidth={terminalWidth}
                        onAnswer={answerListDialog}
                    />

                    <TempCleanupModal terminalHeight={terminalHeight} terminalWidth={terminalWidth} />

                    <ClosingModal terminalHeight={terminalHeight} />

                    {updateInfo && (
                        <UpdateModal
                            latestVersion={updateInfo.latestVersion}
                            releaseUrl={updateInfo.releaseUrl}
                            terminalHeight={terminalHeight}
                            terminalWidth={terminalWidth}
                        />
                    )}
                </Box>
            )}
        </ImportActionsProvider>
    );
};
