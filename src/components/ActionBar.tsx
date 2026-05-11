import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { useFocusContext } from "../contexts/FocusContext";
import { FlowBase } from "../base/flow/flow-base";
import { Task } from "../base/task/task";
import { getShortcutLiteral } from "../types/actions";
import { useTheme } from "../base/themeContext";

export const ActionBar: React.FC<{
  tasks: Task[];
  flow: FlowBase | undefined;
}> = ({ tasks, flow }) => {
  const theme = useTheme();
  const { focusState } = useFocusContext();
  const isTaskListActive = focusState.activeWindow === "taskList";
  const selectedIndex = focusState.taskList.selectedTaskIndex;
  const multiCount = focusState.taskList.selectedTaskIds.size;

  const bar = useMemo(() => {
    if (!isTaskListActive || !flow || !tasks[selectedIndex]) return null;
    return flow.getContextualActionBar(tasks[selectedIndex], {
      columnIndex: focusState.taskList.selectedColumnIndex,
    });
  }, [
    isTaskListActive,
    flow,
    tasks,
    selectedIndex,
    focusState.taskList.selectedColumnIndex,
  ]);

  const visibleActions = useMemo(() => {
    if (!bar) return [];
    return bar.actions.filter((action) => {
      if (multiCount > 1 && !action.multiSelectAllowed) return false;
      if (multiCount <= 1 && action.multiSelectOnly) return false;
      return true;
    });
  }, [bar, multiCount]);

  return (
    <Box
      paddingX={1}
      height={1}
      overflow="hidden"
      borderStyle="single"
      borderColor={theme.ui.border}
      borderBackgroundColor={theme.ui.background}
      borderTop={false}
      borderBottom={false}
    >
      {bar && visibleActions.length > 0 ? (
        <>
          {bar.text && (
            <Box marginRight={2}>
              <Text color={bar.textColor ?? theme.text.primary} bold>
                {bar.text}
              </Text>
            </Box>
          )}
          {visibleActions.map((action, index) => (
            <Box key={`action-${action.label}-${index}`} marginRight={2}>
              <Text color={action.color ?? theme.text.active}>
                {`[${getShortcutLiteral(action.shortcuts)}] ${action.label}`}
              </Text>
            </Box>
          ))}
        </>
      ) : (
        <Text color={theme.text.hint} italic>
          No contextual actions available
        </Text>
      )}
    </Box>
  );
};
