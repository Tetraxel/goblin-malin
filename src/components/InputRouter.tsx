import React from "react";
import { useFocusActions, useFocusChrome, useFocusSecondaryPanel } from "#contexts/FocusContext";
import { useShortcuts } from "#hooks/useShortcuts";
import { useToolbarShortcuts, useTaskListShortcuts, usePromptShortcuts } from "#hooks/useKeyHandlers";
import { FlowBase } from "#base/flow/flow-base";
import { Task } from "#base/task/task";
import { useImportActions } from "#contexts/ImportActionsContext";
import { statsDisplay } from "#base/statsDisplay";

/**
 * Registers all global and window-specific keyboard shortcuts with the
 * ShortcutRegistry. Renders nothing — the ShortcutDispatcher handles dispatch.
 */
export const InputRouter: React.FC<{
    tasks: Task[];
    flow: FlowBase | undefined;
}> = ({ tasks, flow }) => {
    const { handleTabPress, switchMode, setPrimaryMode, setSecondaryTab } = useFocusActions();
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
                label: "Metadata Sources tab",
                handler: () => setSecondaryTab("metadataSources"),
            },
            {
                id: "global.tab4",
                defaultShortcut: { input: "4" },
                label: "Download Sources tab",
                handler: () => setSecondaryTab("downloadSources"),
            },
            {
                id: "global.tab5",
                defaultShortcut: { input: "5" },
                label: "Logs tab",
                handler: () => setSecondaryTab("logs"),
            },
            {
                id: "global.toggleStats",
                defaultShortcut: { funcKey: 3 },
                label: "Toggle stats",
                handler: () => statsDisplay.toggle(),
            },
        ],
    });

    useToolbarShortcuts();
    useTaskListShortcuts(tasks, flow);
    usePromptShortcuts(tasks);

    return null;
};
