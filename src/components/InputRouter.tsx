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
  const { focusState, handleTabPress, switchMode, setPrimaryMode, setSecondaryTab } =
    useFocusContext();

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

    // [1] Metadata mode: switch task list columns + reset secondary tab to sources
    if (input === "1") {
      if (flow) switchMode(flow, input);
      setPrimaryMode("metadata");
      return;
    }

    // [2] Download mode: switch task list columns + reset secondary tab to sources
    if (input === "2") {
      if (flow) switchMode(flow, input);
      setPrimaryMode("download");
      return;
    }

    // [3] Secondary panel: sources tab
    if (input === "3") {
      setSecondaryTab("sources");
      return;
    }

    // [4] Secondary panel: logs tab
    if (input === "4") {
      setSecondaryTab("logs");
      return;
    }

    // [5]-[9]: remaining flow mode switches
    const digit = Number(input);
    if (digit >= 5 && digit <= 9) {
      if (flow) switchMode(flow, input);
      return;
    }

    // Else route input to the specific shortcuts for the active window
    handlers[focusState.activeWindow]?.(input, key);
  });

  return null;
};
