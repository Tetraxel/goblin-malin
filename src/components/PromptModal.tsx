import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import SelectInput from "ink-select-input";
import { Task } from "../base/task/task";
import { PromptType } from "../base/task/task-prompt";
import { useActivePrompt } from "../hooks/useActivePrompt";
import { useFocusContext } from "../contexts/FocusContext";
import { useTheme } from "../base/themeContext";

interface PromptModalProps {
  tasks: Task[];
  terminalHeight: number;
  terminalWidth: number;
}

export const PromptModal: React.FC<PromptModalProps> = ({
  tasks,
  terminalHeight,
  terminalWidth,
}) => {
  const theme = useTheme();
  const { switchWindow, switchBack } = useFocusContext();
  const [inputValue, setInputValue] = useState("");
  const { task, prompt } = useActivePrompt(tasks);
  const currentPrompt = prompt?.getCurrentPrompt();

  useEffect(() => {
    if (Boolean(prompt)) {
      switchWindow("prompt");
    } else {
      switchBack();
    }
  }, [prompt]);

  const handleInputSubmit = (value: string) => {
    if (!task || !prompt) return;

    if (currentPrompt?.type === PromptType.Input) {
      prompt.resolvePrompt(value);
    }
  };

  const handleSelectSubmit = (item: { label: string; value: string }) => {
    if (!task || !prompt) return;

    if (currentPrompt?.type === PromptType.Select) {
      prompt.resolvePrompt(item.value);
    }
  };

  if (!task || !prompt || !currentPrompt) {
    return null;
  }

  const modalWidth = Math.min(70, terminalWidth - 10);
  const verticalPadding = Math.floor((terminalHeight - 10) / 2);

  return (
    <Box
      position="absolute"
      width="100%"
      height={terminalHeight}
      flexDirection="column"
    >
      <Box height={Math.max(0, verticalPadding)} />

      <Box width="100%" justifyContent="center">
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor={theme.ui.modalBorder}
          borderBackgroundColor={theme.ui.background}
          paddingX={2}
          paddingY={1}
          width={modalWidth}
          backgroundColor={theme.ui.background}
        >
          <Text bold color={theme.ui.modalBorder}>
            {currentPrompt.title + " - " + task.getId()}
          </Text>

          <Box marginTop={1}>
            <Text>{currentPrompt.message}</Text>
          </Box>

          <Box marginTop={1} flexDirection="column">
            {currentPrompt.type === PromptType.Confirm && (
              <>
                <Text dimColor>Press Y for Yes, N for No</Text>
                <Text dimColor>Press ESC to cancel</Text>
              </>
            )}

            {currentPrompt.type === PromptType.Input && (
              <>
                <Box>
                  <Text color={theme.status.success}>{">"} </Text>
                  <TextInput
                    value={inputValue}
                    onChange={setInputValue}
                    onSubmit={handleInputSubmit}
                    placeholder={currentPrompt.hint || "Enter value…"}
                  />
                </Box>
                <Box marginTop={1}>
                  <Text dimColor>Press ENTER to submit, ESC to cancel</Text>
                </Box>
              </>
            )}

            {currentPrompt.type === PromptType.Select && (
              <>
                <Box marginTop={1}>
                  <SelectInput
                    items={currentPrompt.options}
                    onSelect={handleSelectSubmit}
                  />
                </Box>
                <Box marginTop={1}>
                  <Text dimColor>
                    Use arrow keys to select, ENTER to confirm, ESC to cancel
                  </Text>
                </Box>
              </>
            )}
          </Box>
        </Box>
      </Box>

      <Box flexGrow={1} />
    </Box>
  );
};
