import type React from "react";
import { useFocusActions, useFocusChrome, useFocusSecondaryPanel } from "#contexts/FocusContext";
import { useShortcuts } from "#hooks/useShortcuts";
import { useToolbarShortcuts, useTaskListShortcuts, usePromptShortcuts } from "#hooks/useKeyHandlers";
import { type Task } from "#base/task/task";
import { type ColumnDefinition } from "#components/TaskListPanel/TaskListPanel";
import { type MusicDownloadTaskAttributes } from "#flows/musicDownloadFlow/types";
import { useImportActions } from "#contexts/ImportActionsContext";
import { statsDisplay } from "#base/statsDisplay";
import { getInstance } from "#utils/mpvPlayer";
import { chatPanelState } from "./ChatPanel/chatPanelState";

/**
 * Registers all global and window-specific keyboard shortcuts with the
 * ShortcutRegistry. Renders nothing — the ShortcutDispatcher handles dispatch.
 */
export const InputRouter: React.FC<{
    tasks: Task[];
    columns: ColumnDefinition<MusicDownloadTaskAttributes>[];
}> = ({ tasks, columns }) => {
    const { handleTabPress, setPrimaryMode, setSecondaryTab, switchWindow } = useFocusActions();
    const { activeWindow, isEditingField } = useFocusChrome();
    const secondaryPanel = useFocusSecondaryPanel();
    const { openImportFlow } = useImportActions();

    const isMainScreen =
        activeWindow !== "importModal" &&
        activeWindow !== "settingsModal" &&
        activeWindow !== "setupWizardModal" &&
        activeWindow !== "welcomeModal" &&
        activeWindow !== "updateModal";

    const isDetailFocused =
        activeWindow === "secondaryPanel" &&
        secondaryPanel.subTab !== "logs" &&
        secondaryPanel.subTab !== "stems" &&
        secondaryPanel.sourcesPanel.innerFocus === "detail";

    // Global shortcuts — active on the main screen, not while editing a field.
    useShortcuts({
        id: "global",
        isActive: isMainScreen && !isEditingField,
        priority: 50,
        shortcuts: [
            {
                id: "global.tab",
                defaultShortcut: { key: "tab" },
                label: "Switch panel",
                handler: () => handleTabPress(),
            },
            {
                id: "global.import",
                defaultShortcut: { input: "v", ctrl: true },
                label: "Import URL",
                // Skip when detail panel is focused (it handles its own Ctrl+V for paste).
                handler: () => {
                    if (!isDetailFocused) openImportFlow();
                },
            },
            // The tab lines show these keys (`TAB_SHORTCUT_IDS`): ids by name, not by number, since the numbers moved
            // when the Stems tabs came (P33; `SETTINGS_MIGRATIONS[3]` carried the user's own keys over).
            {
                id: "global.metadataView",
                defaultShortcut: { input: "1" },
                label: "Metadata view",
                handler: () => setPrimaryMode("metadata"),
            },
            {
                id: "global.downloadView",
                defaultShortcut: { input: "2" },
                label: "Download view",
                handler: () => setPrimaryMode("download"),
            },
            {
                id: "global.stemsView",
                defaultShortcut: { input: "3" },
                label: "Stems view",
                handler: () => setPrimaryMode("stems"),
            },
            {
                id: "global.metadataSourcesTab",
                defaultShortcut: { input: "4" },
                label: "Metadata Sources tab",
                handler: () => setSecondaryTab("metadataSources"),
            },
            {
                id: "global.downloadSourcesTab",
                defaultShortcut: { input: "5" },
                label: "Download Sources tab",
                handler: () => setSecondaryTab("downloadSources"),
            },
            {
                id: "global.stemsTab",
                defaultShortcut: { input: "6" },
                label: "Stems tab",
                handler: () => setSecondaryTab("stems"),
            },
            {
                id: "global.logsTab",
                defaultShortcut: { input: "7" },
                label: "Logs tab",
                handler: () => setSecondaryTab("logs"),
            },
            {
                id: "global.chat",
                defaultShortcut: { input: "t", ctrl: true },
                label: "Talk to Claude",
                // Opens the chat and puts the keyboard in it (the chat's own Ctrl+T closes it).
                handler: () => {
                    chatPanelState.setOpen(true);
                    switchWindow("chatPanel");
                },
            },
            {
                id: "global.togglePlayback",
                defaultShortcut: { input: "p", ctrl: true },
                label: "Pause/resume playback",
                // Playback continues in the background, so it needs a control that works from any panel.
                handler: () => {
                    const player = getInstance();
                    const status = player.getStatus();
                    if (status.isPlaying || status.isPaused) player.togglePause().catch(() => {});
                },
            },
            {
                id: "global.toggleStats",
                defaultShortcut: { funcKey: 3 },
                label: "Toggle stats",
                handler: () => statsDisplay.toggle(),
            },
        ],
    });

    // Esc, Esc from either working panel hands focus to the toolbar. Low priority is fine:
    // double-tap bindings are matched before single-press ones (see ShortcutRegistry.dispatch).
    useShortcuts({
        id: "navigation",
        isActive: (activeWindow === "taskList" || activeWindow === "secondaryPanel") && !isEditingField,
        priority: 50,
        shortcuts: [
            {
                id: "navigation.focusToolbar",
                defaultShortcut: { key: "escape", doubleTap: true },
                label: "Focus toolbar",
                handler: () => switchWindow("toolbar"),
            },
        ],
    });

    useToolbarShortcuts();
    useTaskListShortcuts(tasks, columns);
    usePromptShortcuts(tasks);

    return null;
};
