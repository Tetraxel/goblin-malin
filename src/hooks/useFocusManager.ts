import { useState, useCallback, useEffect } from 'react';
import { useScreenSize } from './useScreenSize';
import { FlowBase } from '../base/flow/flow-base';

const TOOLBAR_HEIGHT = 1;
const TASK_LIST_HEIGHT = 30;
const FOOTER_HEIGHT = 2;
const SEPARATOR_HEIGHT = 4;

export type FocusableWindow =
  | 'toolbar'
  | 'taskList'
  | 'logPanel'
  | 'footer'
  | 'prompt'
  | 'secondaryPanel'
  | 'settingsModal'
  | 'importModal';

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
    selectedTaskIds: Set<string>;
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
  prompt: Record<string, never>;
  secondaryPanel: {
    mode: 'metadataSources' | 'download' | 'logs';
    selectedRowIndex: number;
    scrollOffset: number;
  };
  modal: {
    type: 'settings' | 'import' | null;
  };
}

function calculateLogPanelHeight(
  terminalHeight: number,
  taskListHeight: number,
  toolbarHeight: number,
  footerHeight: number,
) {
  return terminalHeight - taskListHeight - toolbarHeight - footerHeight - SEPARATOR_HEIGHT;
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
      selectedTaskIds: new Set<string>(),
      width: terminalWidth,
    },
    logPanel: {
      height: calculateLogPanelHeight(terminalHeight, TASK_LIST_HEIGHT, TOOLBAR_HEIGHT, FOOTER_HEIGHT),
      selectedLogIndex: Math.max(0, 10),
      width: terminalWidth,
    },
    footer: {
      height: FOOTER_HEIGHT,
    },
    prompt: {},
    secondaryPanel: {
      mode: 'metadataSources',
      selectedRowIndex: 0,
      scrollOffset: 0,
    },
    modal: {
      type: null,
    },
  });

  useEffect(() => {
    setFocusState((prev) => ({
      ...prev,
      logPanel: {
        ...prev.logPanel,
        width: terminalWidth,
      },
    }));
  }, [terminalWidth]);

  const switchWindow = useCallback((window: FocusableWindow) => {
    setFocusState((prev) => ({
      ...prev,
      previousWindow: prev.activeWindow,
      activeWindow: window,
    }));
  }, []);

  const switchBack = useCallback(() => {
    setFocusState((prev) => {
      if (!prev.previousWindow || prev.previousWindow === 'prompt')
        return {
          ...prev,
          activeWindow: 'toolbar',
          toolbar: {
            ...prev.toolbar,
            selectedButtonIndex: 0,
          },
        };
      return { ...prev, activeWindow: prev.previousWindow };
    });
  }, []);

  const handleTabPress = useCallback(() => {
    setFocusState((prev) => {
      const windows: FocusableWindow[] = ['toolbar', 'taskList', 'secondaryPanel'];
      const currentIndex = windows.indexOf(prev.activeWindow);
      const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % windows.length;
      return { ...prev, activeWindow: windows[nextIndex] };
    });
  }, []);

  const switchMode = useCallback((flow: FlowBase | undefined, input: string) => {
    if (!flow || typeof flow.switchMode !== 'function') {
      return;
    }
    flow.switchMode(input);
  }, []);

  const resizeTaskList = useCallback(
    (direction: 'up' | 'down') => {
      setFocusState((prev) => {
        const newHeight =
          direction === 'up'
            ? Math.max(5, prev.taskList.height - 2)
            : Math.min(terminalHeight - 10, prev.taskList.height + 2);
        const logPaneHeight = calculateLogPanelHeight(
          terminalHeight,
          newHeight,
          prev.toolbar.height,
          prev.footer.height,
        );
        return {
          ...prev,
          taskList: { ...prev.taskList, height: newHeight },
          logPanel: { ...prev.logPanel, height: logPaneHeight },
        };
      });
    },
    [terminalHeight],
  );

  const moveToolbarSelection = useCallback(
    (direction: 'left' | 'right' | 'down') => {
      setFocusState((prev) => {
        if (direction === 'down') {
          if (taskCount === 0) return prev;
          return {
            ...prev,
            activeWindow: 'taskList',
            taskList: { ...prev.taskList, selectedTaskIndex: 0, selectedColumnIndex: 0 },
          };
        }
        const newIndex =
          direction === 'left'
            ? Math.max(0, prev.toolbar.selectedButtonIndex - 1)
            : Math.min(toolbarButtonCount - 1, prev.toolbar.selectedButtonIndex + 1);
        return {
          ...prev,
          toolbar: { ...prev.toolbar, selectedButtonIndex: newIndex },
        };
      });
    },
    [taskCount, toolbarButtonCount],
  );

  const moveTaskSelection = useCallback(
    (direction: 'up' | 'down' | 'left' | 'right') => {
      setFocusState((prev) => {
        if (direction === 'up' || direction === 'down') {
          let newIndex =
            direction === 'up'
              ? prev.taskList.selectedTaskIndex - 1
              : prev.taskList.selectedTaskIndex + 1;

          if (newIndex < 0) {
            return {
              ...prev,
              activeWindow: 'toolbar',
              toolbar: { ...prev.toolbar, selectedButtonIndex: 0 },
            };
          }

          if (newIndex >= taskCount) {
            return prev;
          }

          return {
            ...prev,
            taskList: { ...prev.taskList, selectedTaskIndex: newIndex },
          };
        } else {
          const newColumnIndex =
            direction === 'left'
              ? Math.max(0, prev.taskList.selectedColumnIndex - 1)
              : Math.min(taskColumnCount - 1, prev.taskList.selectedColumnIndex + 1);
          return {
            ...prev,
            taskList: { ...prev.taskList, selectedColumnIndex: newColumnIndex },
          };
        }
      });
    },
    [taskCount, taskColumnCount],
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

  return {
    focusState,
    switchWindow,
    switchBack,
    handleTabPress,
    switchMode,
    resizeTaskList,
    moveToolbarSelection,
    moveTaskSelection,
    toggleTaskSelection,
    selectAllTasks,
    clearSelection,
  };
};
