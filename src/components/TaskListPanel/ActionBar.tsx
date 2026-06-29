import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { FlowBase } from "#base/flow/flow-base";
import { Task } from "#base/task/task";
import { useTheme } from "#base/themeContext";
import { useFocusChrome, useFocusTaskList } from "#contexts/FocusContext";
import { ActionBarRow, getContextualShortcutIds } from "#types/actions";
import { Hint } from "../Hint";

export const ActionBar: React.FC<{
    tasks: Task[];
    flow: FlowBase | undefined;
}> = ({ tasks, flow }) => {
    const theme = useTheme();
    const { activeWindow } = useFocusChrome();
    const taskList = useFocusTaskList();
    const isTaskListActive = activeWindow === "taskList";
    const selectedIndex = taskList.selectedTaskIndex;
    const multiCount = taskList.selectedTaskIds.size;
    const selectedTask = tasks[selectedIndex];

    const [, setTaskVersion] = useState(0);
    useEffect(() => {
        if (!selectedTask) return;
        return selectedTask.subscribe(() => setTaskVersion((v) => v + 1));
    }, [selectedTask]);

    const bar =
        isTaskListActive && flow && selectedTask
            ? flow.getContextualActionBar(selectedTask, {
                  columnIndex: taskList.selectedColumnIndex,
                  taskIndex: selectedIndex,
                  taskCount: tasks.length,
                  selectedCount: multiCount > 1 ? multiCount : undefined,
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
                                    <Hint key={j} label={action.label} shortcutIds={getContextualShortcutIds(action)} />
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
