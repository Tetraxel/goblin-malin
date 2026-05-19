import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { useFocusContext } from "../../contexts/FocusContext";
import { FlowBase } from "../../base/flow/flow-base";
import { Task } from "../../base/task/task";
import { ActionBarRow, getShortcutLiteral } from "../../types/actions";
import { useTheme } from "../../base/themeContext";
import { Hint } from "../Hint";

export const ActionBar: React.FC<{
    tasks: Task[];
    flow: FlowBase | undefined;
}> = ({ tasks, flow }) => {
    const theme = useTheme();
    const { focusState } = useFocusContext();
    const isTaskListActive = focusState.activeWindow === "taskList";
    const selectedIndex = focusState.taskList.selectedTaskIndex;
    const multiCount = focusState.taskList.selectedTaskIds.size;
    const selectedTask = tasks[selectedIndex];

    const [, setTaskVersion] = useState(0);
    useEffect(() => {
        if (!selectedTask) return;
        return selectedTask.subscribe(() => setTaskVersion((v) => v + 1));
    }, [selectedTask]);

    const bar =
        isTaskListActive && flow && selectedTask
            ? flow.getContextualActionBar(selectedTask, {
                  columnIndex: focusState.taskList.selectedColumnIndex,
                  taskIndex: selectedIndex,
                  taskCount: tasks.length,
              })
            : null;

    const rowCount = bar?.rows.length ?? 1;

    const filterRow = (row: ActionBarRow) =>
        row.actions.filter((action) => {
            if (multiCount > 1 && !action.multiSelectAllowed) return false;
            if (multiCount <= 1 && action.multiSelectOnly) return false;
            return true;
        });

    if (!isTaskListActive) return null;

    return (
        <Box
            paddingX={1}
            height={rowCount}
            overflow="hidden"
            flexGrow={1}
            flexDirection="column"
            alignItems="flex-start"
        >
            {bar ? (
                bar.rows.map((row, i) => {
                    const visible = filterRow(row);
                    return (
                        <Box key={i} height={1} flexDirection="row" alignItems="flex-start" flexShrink={0}>
                            {row.text && (
                                <Box marginRight={1} flexShrink={0}>
                                    <Text color={row.textColor ?? theme.text.primary} bold>
                                        {row.text}
                                    </Text>
                                </Box>
                            )}
                            <Box marginRight={1} flexShrink={0}>
                                <Text color={theme.text.hint}>›</Text>
                            </Box>
                            {visible.length > 0 ? (
                                visible.map((action, j) => (
                                    <Hint
                                        key={j}
                                        label={action.label}
                                        shortcut={getShortcutLiteral(action.shortcuts)}
                                    />
                                ))
                            ) : (
                                <Text color={theme.text.hint} italic>
                                    —
                                </Text>
                            )}
                        </Box>
                    );
                })
            ) : (
                <Box height={1} flexDirection="row" alignItems="flex-start">
                    <Text color={theme.text.hint} italic>
                        No contextual actions available
                    </Text>
                </Box>
            )}
        </Box>
    );
};
