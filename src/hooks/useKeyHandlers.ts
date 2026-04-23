import { Key } from 'ink';
import { useFocusContext } from '../contexts/FocusContext';
import { useToolbarActionsRef } from '../contexts/ToolbarActionsContext';
import { FlowBase } from '../base/flow/flow-base';
import { Task } from '../base/task/task';
import { PromptType } from '../base/task/task-prompt';
import { useActivePrompt } from './useActivePrompt';
import { matchesShortcut } from '../types/actions';

export type KeyHandler = (input: string, key: Key) => void;

export function useToolbarKeyHandler(): KeyHandler {
  const { focusState, moveToolbarSelection } = useFocusContext();
  const actionsRef = useToolbarActionsRef();
  return (_input: string, key: Key) => {
    if (key.leftArrow) moveToolbarSelection('left');
    if (key.rightArrow) moveToolbarSelection('right');
    if (key.downArrow) moveToolbarSelection('down');
    if (key.return) {
      actionsRef.current[focusState.toolbar.selectedButtonIndex]?.();
    }
  };
}

export function useTaskListKeyHandler(tasks: Task[], flow: FlowBase | undefined): KeyHandler {
  const {
    focusState,
    moveTaskSelection,
    resizePanels,
    toggleTaskSelection,
    selectAllTasks,
    clearSelection,
  } = useFocusContext();

  return (input: string, key: Key) => {
    if (key.upArrow) {
      if (key.shift) resizePanels('shrink');
      else moveTaskSelection('up');
    }
    if (key.downArrow) {
      if (key.shift) resizePanels('grow');
      else moveTaskSelection('down');
    }
    if (key.leftArrow) moveTaskSelection('left');
    if (key.rightArrow) moveTaskSelection('right');

    // Ctrl+A: toggle select all
    if (key.ctrl && input === 'a') {
      selectAllTasks(tasks.map((t) => t.getId()));
      return;
    }

    // Esc: clear multi-selection
    if (key.escape) {
      clearSelection();
      return;
    }

    // Contextual actions take priority (includes Space if a column action is bound to it)
    if (flow) {
      const selectedTask = tasks[focusState.taskList.selectedTaskIndex];
      if (selectedTask) {
        const bar = flow.getContextualActionBar(selectedTask, {
          columnIndex: focusState.taskList.selectedColumnIndex,
        });
        if (bar) {
          const multiCount = focusState.taskList.selectedTaskIds.size;
          const matchingAction = bar.actions.find((action) => {
            if (multiCount > 1 && !action.multiSelectAllowed) return false;
            if (multiCount <= 1 && action.multiSelectOnly) return false;
            return action.shortcuts.some((s) => matchesShortcut(s, input, key));
          });
          if (matchingAction) {
            if (multiCount > 1 && matchingAction.onClickBatch) {
              const selectedTasks = tasks.filter((t) =>
                focusState.taskList.selectedTaskIds.has(t.getId()),
              );
              matchingAction.onClickBatch(selectedTasks);
            } else {
              matchingAction.onClick();
            }
            return;
          }
        }
      }
    }

    // Space: multi-select toggle (fallback when no column action is bound to Space)
    if (input === ' ') {
      const task = tasks[focusState.taskList.selectedTaskIndex];
      if (task) toggleTaskSelection(task.getId());
    }
  };
}

export function usePromptKeyHandler(tasks: Task[]): KeyHandler {
  const { task, prompt } = useActivePrompt(tasks);

  return (input: string, key: Key) => {
    if (!task || !prompt) return;
    const currentPrompt = prompt.getCurrentPrompt();

    if (key.escape) {
      prompt.cancelPrompt(new Error('User cancelled'));
      return;
    }

    if (currentPrompt?.type === PromptType.Confirm) {
      if (input.toLowerCase() === 'y') prompt.resolvePrompt(true);
      else if (input.toLowerCase() === 'n') prompt.resolvePrompt(false);
    }
  };
}
