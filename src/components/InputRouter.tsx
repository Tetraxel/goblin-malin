import React from "react";
import { useFocusContext } from "#contexts/FocusContext";
import { useShortcuts } from "#hooks/useShortcuts";
import { useToolbarShortcuts, useTaskListShortcuts, usePromptShortcuts } from "#hooks/useKeyHandlers";
import { FlowBase } from "#base/flow/flow-base";
import { Task } from "#base/task/task";
import { useImportActions } from "#contexts/ImportActionsContext";

/**
 * Registers all global and window-specific keyboard shortcuts with the
 * ShortcutRegistry. Renders nothing — the ShortcutDispatcher handles dispatch.
 */
export const InputRouter: React.FC<{
    tasks: Task[];
    flow: FlowBase | undefined;
}> = ({ tasks, flow }) => {
    const { focusState, handleTabPress, switchMode, setPrimaryMode, setSecondaryTab } = useFocusContext();
    const { openImportFlow } = useImportActions();

    const isMainScreen =
        focusState.activeWindow !== "importModal" &&
        focusState.activeWindow !== "settingsModal" &&
        focusState.activeWindow !== "setupWizardModal" &&
        focusState.activeWindow !== "welcomeModal";

    const isDetailFocused =
        focusState.activeWindow === "secondaryPanel" &&
        focusState.secondaryPanel.subTab === "sources" &&
        focusState.secondaryPanel.sourcesPanel.innerFocus === "detail";

    // Global shortcuts — active on the main screen, not while editing a field.
    useShortcuts({
        id: "global",
        isActive: isMainScreen && !focusState.isEditingField,
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
            {
                id: "global.mode1",
                defaultShortcut: { input: "1" },
                label: "Metadata mode",
                handler: () => {
                    if (flow) switchMode(flow, "1");
                    setPrimaryMode("metadata");
                },
            },
            {
                id: "global.mode2",
                defaultShortcut: { input: "2" },
                label: "Download mode",
                handler: () => {
                    if (flow) switchMode(flow, "2");
                    setPrimaryMode("download");
                },
            },
            {
                id: "global.tab3",
                defaultShortcut: { input: "3" },
                label: "Sources tab",
                handler: () => setSecondaryTab("sources"),
            },
            {
                id: "global.tab5",
                defaultShortcut: { input: "5" },
                label: "Logs tab",
                handler: () => setSecondaryTab("logs"),
            },
        ],
    });

    useToolbarShortcuts();
    useTaskListShortcuts(tasks, flow);
    usePromptShortcuts(tasks);

    return null;
};
