import { useState, useCallback, useMemo } from "react";
import { useScreenSize } from "./useScreenSize";
import { FlowBase } from "#base/flow/flow-base";
import { SetupWizardConfig } from "#base/setupWizard";

export type CursorPosition =
    | { type: "compiled" }
    | { type: "group"; groupIndex: number }
    | { type: "result"; groupIndex: number; resultIndex: number };

// Fixed rows that never change regardless of terminal size.
// toolbarRows = top separator + toolbar content + bottom separator.
// ActionBar is now rendered inside TaskListPanel (not counted here).
const LAYOUT = {
    toolbarRows: 3,
    overheadRows: 3, // separatorBeforeFooter(1) + footer(2)
} as const;

function computeContentHeight(terminalHeight: number): number {
    return Math.max(10, terminalHeight - LAYOUT.toolbarRows - LAYOUT.overheadRows);
}

function initLayout(terminalHeight: number) {
    const contentHeight = computeContentHeight(terminalHeight);
    const taskListHeight = Math.floor(contentHeight / 2);
    const secondaryPanelHeight = contentHeight - taskListHeight;
    return { taskListHeight, secondaryPanelHeight, contentHeight };
}

export type FocusableWindow =
    | "toolbar"
    | "taskList"
    | "logPanel"
    | "footer"
    | "prompt"
    | "secondaryPanel"
    | "settingsModal"
    | "sessionsModal"
    | "importModal"
    | "startModal"
    | "setupWizardModal"
    | "welcomeModal"
    | "updateModal"
    | "confirmModal";

export interface FocusState {
    activeWindow: FocusableWindow;
    previousWindow: FocusableWindow | undefined;
    returningFromWindow: FocusableWindow | undefined;
    toolbar: {
        selectedButtonIndex: number;
        height: number;
    };
    taskList: {
        selectedTaskIndex: number;
        selectedColumnIndex: number;
        selectedTaskIds: Set<string>;
        width: number;
        isHeaderFocused: boolean;
    };
    logPanel: {
        selectedLogIndex: number;
        width: number;
    };
    footer: {
        height: number;
    };
    layout: {
        taskListHeight: number;
        secondaryPanelHeight: number;
        contentHeight: number;
    };
    prompt: Record<string, never>;
    secondaryPanel: {
        primaryMode: "metadata" | "download";
        subTab: "metadataSources" | "downloadSources" | "logs";
        selectedRowIndex: number;
        scrollOffset: number;
        sourcesPanel: {
            cursor: CursorPosition;
            showDiscoverySources: boolean;
            innerFocus: "list" | "detail";
            selectedFieldIndex: number;
        };
    };
    modal: {
        type: "settings" | "import" | "welcome" | null;
    };
    wizardConfig: SetupWizardConfig | null;
    wizardOnDisable: (() => void) | null;
    isEditingField: boolean;
}

export const useFocusManager = ({
    toolbarButtonCount,
    taskCount,
    taskColumnCount,
}: {
    toolbarButtonCount: number;
    taskCount: number;
    taskColumnCount: number;
}) => {
    const { height: terminalHeight, width: terminalWidth } = useScreenSize();

    // Stores the user's explicit task-list height; clamped in the layout memo on resize.
    const [manualTaskListHeight, setManualTaskListHeight] = useState(() => initLayout(terminalHeight).taskListHeight);

    const layout = useMemo(() => {
        const contentHeight = computeContentHeight(terminalHeight);
        const taskListHeight = Math.max(5, Math.min(manualTaskListHeight, contentHeight - 5));
        return { taskListHeight, secondaryPanelHeight: contentHeight - taskListHeight, contentHeight };
    }, [terminalHeight, manualTaskListHeight]);

    const [focusState, setFocusState] = useState<FocusState>(() => ({
        activeWindow: "toolbar",
        previousWindow: undefined,
        returningFromWindow: undefined,
        toolbar: {
            height: 1,
            selectedButtonIndex: 0,
        },
        taskList: {
            selectedTaskIndex: 0,
            selectedColumnIndex: 2,
            selectedTaskIds: new Set<string>(),
            width: terminalWidth,
            isHeaderFocused: false,
        },
        logPanel: {
            selectedLogIndex: 0,
            width: terminalWidth,
        },
        footer: {
            height: 2,
        },
        layout: initLayout(terminalHeight),
        prompt: {},
        secondaryPanel: {
            primaryMode: "metadata",
            subTab: "metadataSources",
            selectedRowIndex: 0,
            scrollOffset: 0,
            sourcesPanel: {
                cursor: { type: "compiled" },
                showDiscoverySources: false,
                innerFocus: "list",
                selectedFieldIndex: 0,
            },
        },
        modal: {
            type: null,
        },
        wizardConfig: null,
        wizardOnDisable: null,
        isEditingField: false,
    }));

    const switchWindow = useCallback((window: FocusableWindow) => {
        setFocusState((prev) => ({
            ...prev,
            previousWindow: prev.activeWindow,
            activeWindow: window,
            returningFromWindow: undefined,
        }));
    }, []);

    const switchBack = useCallback(() => {
        setFocusState((prev) => {
            const from = prev.activeWindow;
            if (!prev.previousWindow || prev.previousWindow === "prompt")
                return {
                    ...prev,
                    activeWindow: "toolbar",
                    previousWindow: undefined,
                    returningFromWindow: from,
                    toolbar: { ...prev.toolbar, selectedButtonIndex: 0 },
                };
            return { ...prev, activeWindow: prev.previousWindow, previousWindow: undefined, returningFromWindow: from };
        });
    }, []);

    const handleTabPress = useCallback(() => {
        setFocusState((prev) => {
            const windows: FocusableWindow[] = ["toolbar", "taskList", "secondaryPanel"];
            const currentIndex = windows.indexOf(prev.activeWindow);
            const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % windows.length;
            const nextWindow = windows[nextIndex];
            return {
                ...prev,
                activeWindow: nextWindow,
                taskList: nextWindow === "taskList" ? { ...prev.taskList, isHeaderFocused: false } : prev.taskList,
            };
        });
    }, []);

    const switchMode = useCallback((flow: FlowBase | undefined, input: string) => {
        if (!flow || typeof flow.switchMode !== "function") {
            return;
        }
        flow.switchMode(input);
    }, []);

    const resizePanels = useCallback((direction: "grow" | "shrink") => {
        const delta = direction === "grow" ? 2 : -2;
        setManualTaskListHeight((prev) => prev + delta);
    }, []);

    const setPrimaryMode = useCallback((mode: "metadata" | "download") => {
        setFocusState((prev) => {
            const currentSubTab = prev.secondaryPanel.subTab;
            const newSubTab =
                currentSubTab === "logs" ? "logs" : mode === "metadata" ? "metadataSources" : "downloadSources";
            return {
                ...prev,
                secondaryPanel: {
                    ...prev.secondaryPanel,
                    primaryMode: mode,
                    subTab: newSubTab,
                },
            };
        });
    }, []);

    const setSecondaryTab = useCallback((tab: "metadataSources" | "downloadSources" | "logs") => {
        setFocusState((prev) => ({
            ...prev,
            secondaryPanel: {
                ...prev.secondaryPanel,
                subTab: tab,
            },
        }));
    }, []);

    const moveToolbarSelection = useCallback(
        (direction: "left" | "right" | "down") => {
            setFocusState((prev) => {
                if (direction === "down") {
                    return {
                        ...prev,
                        activeWindow: "taskList",
                        taskList: { ...prev.taskList, isHeaderFocused: true },
                    };
                }
                const newIndex =
                    direction === "left"
                        ? Math.max(0, prev.toolbar.selectedButtonIndex - 1)
                        : Math.min(toolbarButtonCount - 1, prev.toolbar.selectedButtonIndex + 1);
                return {
                    ...prev,
                    toolbar: { ...prev.toolbar, selectedButtonIndex: newIndex },
                };
            });
        },
        [toolbarButtonCount]
    );

    const moveTaskSelection = useCallback(
        (direction: "up" | "down" | "left" | "right") => {
            setFocusState((prev) => {
                if (direction === "up" || direction === "down") {
                    if (direction === "up") {
                        if (prev.taskList.isHeaderFocused) {
                            return {
                                ...prev,
                                activeWindow: "toolbar",
                                taskList: { ...prev.taskList, isHeaderFocused: false },
                                toolbar: { ...prev.toolbar, selectedButtonIndex: 0 },
                            };
                        }
                        if (prev.taskList.selectedTaskIndex === 0) {
                            return { ...prev, taskList: { ...prev.taskList, isHeaderFocused: true } };
                        }
                        return {
                            ...prev,
                            taskList: { ...prev.taskList, selectedTaskIndex: prev.taskList.selectedTaskIndex - 1 },
                        };
                    } else {
                        if (prev.taskList.isHeaderFocused) {
                            if (taskCount === 0) return prev;
                            return {
                                ...prev,
                                taskList: { ...prev.taskList, isHeaderFocused: false, selectedTaskIndex: 0 },
                            };
                        }
                        const newIndex = prev.taskList.selectedTaskIndex + 1;
                        if (newIndex >= taskCount) return prev;
                        return { ...prev, taskList: { ...prev.taskList, selectedTaskIndex: newIndex } };
                    }
                } else {
                    const newColumnIndex =
                        direction === "left"
                            ? Math.max(0, prev.taskList.selectedColumnIndex - 1)
                            : Math.min(taskColumnCount - 1, prev.taskList.selectedColumnIndex + 1);
                    return {
                        ...prev,
                        taskList: { ...prev.taskList, selectedColumnIndex: newColumnIndex },
                    };
                }
            });
        },
        [taskCount, taskColumnCount]
    );

    const toggleTaskSelection = useCallback((taskId: string) => {
        setFocusState((prev) => {
            const newSet = new Set(prev.taskList.selectedTaskIds);
            if (newSet.has(taskId)) {
                newSet.delete(taskId);
            } else {
                newSet.add(taskId);
            }
            return { ...prev, taskList: { ...prev.taskList, selectedTaskIds: newSet } };
        });
    }, []);

    const selectAllTasks = useCallback((taskIds: string[]) => {
        setFocusState((prev) => {
            const currentIds = prev.taskList.selectedTaskIds;
            const allSelected = taskIds.length > 0 && taskIds.every((id) => currentIds.has(id));
            const newSet = allSelected ? new Set<string>() : new Set(taskIds);
            return { ...prev, taskList: { ...prev.taskList, selectedTaskIds: newSet } };
        });
    }, []);

    const clearSelection = useCallback(() => {
        setFocusState((prev) => ({
            ...prev,
            taskList: { ...prev.taskList, selectedTaskIds: new Set<string>() },
        }));
    }, []);

    const setCursor = useCallback((cursor: CursorPosition) => {
        setFocusState((prev) => ({
            ...prev,
            secondaryPanel: {
                ...prev.secondaryPanel,
                sourcesPanel: { ...prev.secondaryPanel.sourcesPanel, cursor },
            },
        }));
    }, []);

    const setShowDiscoverySources = useCallback((show: boolean) => {
        setFocusState((prev) => ({
            ...prev,
            secondaryPanel: {
                ...prev.secondaryPanel,
                sourcesPanel: { ...prev.secondaryPanel.sourcesPanel, showDiscoverySources: show },
            },
        }));
    }, []);

    const setSourcesInnerFocus = useCallback((focus: "list" | "detail") => {
        setFocusState((prev) => ({
            ...prev,
            secondaryPanel: {
                ...prev.secondaryPanel,
                sourcesPanel: { ...prev.secondaryPanel.sourcesPanel, innerFocus: focus },
            },
        }));
    }, []);

    const setSourceDetailFieldIndex = useCallback((index: number) => {
        setFocusState((prev) => ({
            ...prev,
            secondaryPanel: {
                ...prev.secondaryPanel,
                sourcesPanel: { ...prev.secondaryPanel.sourcesPanel, selectedFieldIndex: index },
            },
        }));
    }, []);

    const setIsEditingField = useCallback((editing: boolean) => {
        setFocusState((prev) => ({ ...prev, isEditingField: editing }));
    }, []);

    const openUpdateModal = useCallback(() => {
        setFocusState((prev) => ({
            ...prev,
            previousWindow: prev.activeWindow,
            activeWindow: "updateModal",
            returningFromWindow: undefined,
        }));
    }, []);

    const openWizard = useCallback((config: SetupWizardConfig, onDisable?: () => void) => {
        setFocusState((prev) => ({
            ...prev,
            wizardConfig: config,
            wizardOnDisable: onDisable ?? null,
            previousWindow: prev.activeWindow,
            activeWindow: "setupWizardModal",
            returningFromWindow: undefined,
        }));
    }, []);

    // Memoize the width-derived slices so their identity is stable across renders
    // that don't touch them. This is what lets the split FocusContext slices
    // (see FocusContext.tsx) avoid re-rendering chrome consumers on task scroll.
    const taskListSlice = useMemo(
        () => ({ ...focusState.taskList, width: terminalWidth }),
        [focusState.taskList, terminalWidth]
    );
    const logPanelSlice = useMemo(
        () => ({ ...focusState.logPanel, width: terminalWidth }),
        [focusState.logPanel, terminalWidth]
    );
    const derivedFocusState: FocusState = useMemo(
        () => ({ ...focusState, layout, taskList: taskListSlice, logPanel: logPanelSlice }),
        [focusState, layout, taskListSlice, logPanelSlice]
    );

    return {
        focusState: derivedFocusState,
        switchWindow,
        switchBack,
        handleTabPress,
        switchMode,
        resizePanels,
        setPrimaryMode,
        setSecondaryTab,
        moveToolbarSelection,
        moveTaskSelection,
        toggleTaskSelection,
        selectAllTasks,
        clearSelection,
        setCursor,
        setShowDiscoverySources,
        setSourcesInnerFocus,
        setDetailFieldIndex: setSourceDetailFieldIndex,
        setIsEditingField,
        openWizard,
        openUpdateModal,
    };
};
