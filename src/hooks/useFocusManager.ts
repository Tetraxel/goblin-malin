import { useState, useCallback, useEffect } from 'react';
import { useScreenSize } from './useScreenSize';

const TOOLBAR_HEIGHT = 1
const TASK_LIST_HEIGHT = 20
const FOOTER_HEIGHT = 2
const SEPARATOR_HEIGHT = 4

export type FocusableWindow = 'toolbar' | 'taskList' | 'logPanel' | 'footer' | 'prompt';

export interface FocusState {
    activeWindow: FocusableWindow;
    previousWindow: FocusableWindow | undefined;
    toolbar: {
        selectedButtonIndex: number;
        height: number;
    };
    taskList: {
        selectedTaskIndex: number;
        selectedColumnIndex: number;
        height: number;
        width: number;
    };
    logPanel: {
        selectedLogIndex: number;
        height: number;
        width: number;
    };
    footer: {
        height: number;
    };
    prompt: {}
}

function calculateLogPanelHeight(terminalHeight: number, taskListHeight: number, toolbarHeight: number, footerHeight: number) {
    return terminalHeight - taskListHeight - toolbarHeight - footerHeight - SEPARATOR_HEIGHT
}

export const useFocusManager = ({
    toolbarButtonCount,
    taskCount,
    taskColumnCount,
    logCount,
}: {
    toolbarButtonCount: number,
    taskCount: number,
    taskColumnCount: number,
    logCount: number
}) => {
    const { height: terminalHeight, width: terminalWidth } = useScreenSize();
    const [focusState, setFocusState] = useState<FocusState>({
        activeWindow: 'toolbar',
        previousWindow: undefined,
        toolbar: {
            height: TOOLBAR_HEIGHT,
            selectedButtonIndex: 0,
        },
        taskList: {
            height: TASK_LIST_HEIGHT,
            selectedTaskIndex: 0,
            selectedColumnIndex: 0,
            width: terminalWidth,
        },
        logPanel: {
            height: calculateLogPanelHeight(terminalHeight, TASK_LIST_HEIGHT, TOOLBAR_HEIGHT, FOOTER_HEIGHT),
            // Start from last log
            selectedLogIndex: Math.max(0, logCount - 1),
            width: terminalWidth,
        },
        footer: {
            height: FOOTER_HEIGHT
        },
        prompt: {},
    });

    // window size change
    useEffect(() => {
        setFocusState(prev => ({
            ...prev,
            logPanel: {
                ...prev.logPanel,
                width: terminalWidth,
            }
        }))
    }, [terminalWidth]);

    const switchWindow = useCallback((window: FocusableWindow) => {
        setFocusState(prev => ({
            ...prev,
            previousWindow: prev.activeWindow,
            activeWindow: window,
        }));
    }, []);

    const switchBack = useCallback(() => {
        setFocusState(prev => {
            if (!prev.previousWindow || prev.previousWindow == 'prompt')
                return {
                    ...prev, activeWindow: 'toolbar', toolbar: {
                        ...prev.toolbar, selectedButtonIndex: 0
                    }
                }
            return { ...prev, activeWindow: prev.previousWindow }
        });
    }, []);

    const handleTabPress = useCallback(() => {
        setFocusState(prev => {
            const windows: FocusableWindow[] = ['toolbar', 'taskList'];
            const currentIndex = windows.indexOf(prev.activeWindow);
            const nextWindow = windows[(currentIndex + 1) % windows.length];
            return { ...prev, activeWindow: nextWindow };
        });
    }, []);

    const resizeTaskList = useCallback((direction: 'up' | 'down') => {
        setFocusState(prev => {
            const newHeight = direction === 'up'
                ? Math.max(5, prev.taskList.height - 2)
                : Math.min(terminalHeight - 10, prev.taskList.height + 2);
            const logPaneHeight = calculateLogPanelHeight(terminalHeight, newHeight, prev.toolbar.height, prev.footer.height)
            const sum = prev.toolbar.height + newHeight + logPaneHeight + prev.footer.height
            return {
                ...prev,
                taskList: { ...prev.taskList, height: newHeight },
                logPanel: { ...prev.logPanel, height: logPaneHeight },
            };
        });
    }, [logCount]);

    // Navigation within toolbar
    const moveToolbarSelection = useCallback((direction: 'left' | 'right' | 'down') => {
        setFocusState(prev => {
            if (direction === 'down') {
                // If not tasks, do nothing
                if (taskCount === 0)
                    return prev
                // Else move focus to the first task of the list
                return {
                    ...prev,
                    activeWindow: 'taskList',
                    taskList: { ...prev.taskList, selectedTaskIndex: 0, selectedColumnIndex: 0 }
                };
            }
            const newIndex = direction === 'left'
                ? Math.max(0, prev.toolbar.selectedButtonIndex - 1)
                : Math.min(toolbarButtonCount - 1, prev.toolbar.selectedButtonIndex + 1);
            return {
                ...prev,
                toolbar: { ...prev.toolbar, selectedButtonIndex: newIndex }
            };
        });
    }, [taskCount, toolbarButtonCount]);

    // Navigation within task list
    const moveTaskSelection = useCallback((direction: 'up' | 'down' | 'left' | 'right') => {
        setFocusState(prev => {
            if (direction === 'up' || direction === 'down') {
                let newIndex = direction === 'up'
                    ? prev.taskList.selectedTaskIndex - 1
                    : prev.taskList.selectedTaskIndex + 1;

                // Switch to toolbar when going up from index 0
                if (newIndex < 0) {
                    return { ...prev, activeWindow: 'toolbar', toolbar: { ...prev.toolbar, selectedButtonIndex: 0 } };
                }

                newIndex = Math.min(taskCount - 1, Math.max(0, newIndex));
                return {
                    ...prev,
                    taskList: { ...prev.taskList, selectedTaskIndex: newIndex }
                };
            } else {
                // Left/Right for column selection
                const newColumnIndex = direction === 'left'
                    ? Math.max(0, prev.taskList.selectedColumnIndex - 1)
                    : Math.min(taskColumnCount - 1, prev.taskList.selectedColumnIndex + 1);
                return {
                    ...prev,
                    taskList: { ...prev.taskList, selectedColumnIndex: newColumnIndex }
                };
            }
        });
    }, [taskCount, taskColumnCount]);

    // Navigation within log panel
    const moveLogSelection = useCallback((direction: 'up' | 'down') => {
        setFocusState(prev => {
            const newIndex = direction === 'up'
                ? Math.max(0, prev.logPanel.selectedLogIndex - 1)
                : Math.min(logCount - 1, prev.logPanel.selectedLogIndex + 1);
            return {
                ...prev,
                logPanel: { ...prev.logPanel, selectedLogIndex: newIndex }
            };
        });
    }, [logCount]);

    return {
        focusState,
        switchWindow,
        switchBack,
        handleTabPress,
        resizeTaskList,
        moveToolbarSelection,
        moveTaskSelection,
        moveLogSelection,
    };
};
