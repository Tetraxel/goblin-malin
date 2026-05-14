import { useState, useCallback, useEffect } from 'react';
import { useScreenSize } from './useScreenSize';
import { FlowBase } from '../base/flow/flow-base';
import { SetupWizardConfig } from '../base/setupWizard';

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
  | 'toolbar'
  | 'taskList'
  | 'logPanel'
  | 'footer'
  | 'prompt'
  | 'secondaryPanel'
  | 'settingsModal'
  | 'importModal'
  | 'setupWizardModal';

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
    primaryMode: 'metadata' | 'download';
    subTab: 'sources' | 'logs';
    selectedRowIndex: number;
    scrollOffset: number;
    sourcesPanel: {
      selectedSourceIndex: number;
      innerFocus: 'list' | 'detail';
      selectedFieldIndex: number;
    };
  };
  modal: {
    type: 'settings' | 'import' | null;
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

  const [focusState, setFocusState] = useState<FocusState>(() => ({
    activeWindow: 'toolbar',
    previousWindow: undefined,
    returningFromWindow: undefined,
    toolbar: {
      height: 1,
      selectedButtonIndex: 0,
    },
    taskList: {
      selectedTaskIndex: 0,
      selectedColumnIndex: 0,
      selectedTaskIds: new Set<string>(),
      width: terminalWidth,
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
      primaryMode: 'metadata',
      subTab: 'sources',
      selectedRowIndex: 0,
      scrollOffset: 0,
      sourcesPanel: {
        selectedSourceIndex: -1,
        innerFocus: 'list',
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

  useEffect(() => {
    setFocusState((prev) => {
      const contentHeight = computeContentHeight(terminalHeight);
      const prevContent = prev.layout.contentHeight || contentHeight;
      const ratio = prev.layout.taskListHeight / prevContent;
      const taskListHeight = Math.max(5, Math.min(Math.round(contentHeight * ratio), contentHeight - 5));
      const secondaryPanelHeight = contentHeight - taskListHeight;
      return {
        ...prev,
        taskList: { ...prev.taskList, width: terminalWidth },
        logPanel: { ...prev.logPanel, width: terminalWidth },
        layout: { taskListHeight, secondaryPanelHeight, contentHeight },
      };
    });
  }, [terminalHeight, terminalWidth]);

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
      if (!prev.previousWindow || prev.previousWindow === 'prompt')
        return {
          ...prev,
          activeWindow: 'toolbar',
          previousWindow: undefined,
          returningFromWindow: from,
          toolbar: { ...prev.toolbar, selectedButtonIndex: 0 },
        };
      return { ...prev, activeWindow: prev.previousWindow, previousWindow: undefined, returningFromWindow: from };
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

  const resizePanels = useCallback((direction: 'grow' | 'shrink') => {
    setFocusState((prev) => {
      const delta = direction === 'grow' ? 2 : -2;
      const newTaskListHeight = Math.max(
        5,
        Math.min(
          prev.layout.taskListHeight + delta,
          prev.layout.contentHeight - 5,
        ),
      );
      return {
        ...prev,
        layout: {
          ...prev.layout,
          taskListHeight: newTaskListHeight,
          secondaryPanelHeight: prev.layout.contentHeight - newTaskListHeight,
        },
      };
    });
  }, []);

  const setPrimaryMode = useCallback((mode: 'metadata' | 'download') => {
    setFocusState((prev) => ({
      ...prev,
      secondaryPanel: {
        ...prev.secondaryPanel,
        primaryMode: mode,
      },
    }));
  }, []);

  const setSecondaryTab = useCallback((tab: 'sources' | 'logs') => {
    setFocusState((prev) => ({
      ...prev,
      secondaryPanel: {
        ...prev.secondaryPanel,
        subTab: tab,
      },
    }));
  }, []);

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

  const setSelectedSourceIndex = useCallback((index: number) => {
    setFocusState((prev) => ({
      ...prev,
      secondaryPanel: {
        ...prev.secondaryPanel,
        sourcesPanel: { ...prev.secondaryPanel.sourcesPanel, selectedSourceIndex: index },
      },
    }));
  }, []);

  const setSourcesInnerFocus = useCallback((focus: 'list' | 'detail') => {
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

  const openWizard = useCallback((config: SetupWizardConfig, onDisable?: () => void) => {
    setFocusState((prev) => ({
      ...prev,
      wizardConfig: config,
      wizardOnDisable: onDisable ?? null,
      previousWindow: prev.activeWindow,
      activeWindow: 'setupWizardModal',
      returningFromWindow: undefined,
    }));
  }, []);

  return {
    focusState,
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
    setSelectedSourceIndex,
    setSourcesInnerFocus,
    setDetailFieldIndex: setSourceDetailFieldIndex,
    setIsEditingField,
    openWizard,
  };
};
