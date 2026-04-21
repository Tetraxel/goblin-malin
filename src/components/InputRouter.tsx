import React from "react";
import { useInput } from "ink";
import { useFocusContext } from "../contexts/FocusContext";
import {
  useToolbarKeyHandler,
  useTaskListKeyHandler,
  usePromptKeyHandler,
  KeyHandler,
} from "../hooks/useKeyHandlers";
import { FlowBase } from "../base/flow/flow-base";
import { Task } from "../base/task/task";
import { FocusableWindow } from "../hooks/useFocusManager";

export const InputRouter: React.FC<{
  tasks: Task[];
  flow: FlowBase | undefined;
}> = ({ tasks, flow }) => {
  const { focusState, handleTabPress, switchMode } = useFocusContext();

  const toolbarHandler = useToolbarKeyHandler();
  const taskListHandler = useTaskListKeyHandler(tasks, flow);
  const promptHandler = usePromptKeyHandler(tasks);

  const handlers: Partial<Record<FocusableWindow, KeyHandler>> = {
    toolbar: toolbarHandler,
    taskList: taskListHandler,
    prompt: promptHandler,
  };

  useInput((input, key) => {
    // Tab cycles focusable windows
    if (key.tab) {
      handleTabPress();
      return;
    }

    // Digit keys 1–9 switch flow display mode
    const digit = Number(input);
    if (digit >= 1 && digit <= 9) {
      if (flow) switchMode(flow, input);
      return;
    }

    // Else route input to the specific shortcuts for the active window
    handlers[focusState.activeWindow]?.(input, key);
  });

  return null;
};
