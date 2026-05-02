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
  openImportFlow: (text?: string) => void;
}> = ({ tasks, flow, openImportFlow }) => {
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
    // Some terminals (notably Windows Terminal with default keybindings)
    // intercept Ctrl+V and paste the clipboard contents directly into stdin
    // instead of forwarding the keystroke. In raw mode that arrives as a
    // single multi-character chunk in `input`. Sniff for a URL signature and
    // route it through the import flow with the text we already have.
    // This check runs BEFORE the modal guard so pastes append to an open modal.
    if (input.length > 8 && /https?:\/\//i.test(input)) {
      openImportFlow(input);
      return;
    }

    // While a modal owns focus, do not fire global shortcuts — the modal's
    // own useInput handles its keys.
    if (
      focusState.activeWindow === "importModal" ||
      focusState.activeWindow === "settingsModal"
    ) {
      return;
    }

    // While a field is being edited in the detail panel, suppress all global
    // shortcuts so typed characters don't trigger mode switches or other actions.
    if (focusState.isEditingField) return;

    // Ctrl+V: open the clipboard import flow from anywhere on the main screen.
    // On most terminals ink reports key.ctrl + input='v'. On some Windows
    // terminals the keystroke arrives as the raw SYN byte (\x16) without
    // key.ctrl set, so handle both.
    // Skip when the secondary panel detail is focused — it handles its own Ctrl+V for field paste.
    const isDetailFocused =
      focusState.activeWindow === "secondaryPanel" &&
      focusState.secondaryPanel.subTab === "sources" &&
      focusState.secondaryPanel.sourcesPanel.innerFocus === "detail";
    if (!isDetailFocused && ((key.ctrl && (input === "v" || input === "V")) || input === "\x16")) {
      openImportFlow();
      return;
    }

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
