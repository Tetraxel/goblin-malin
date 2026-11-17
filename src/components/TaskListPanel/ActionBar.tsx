import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { type Task } from "#base/task/task";
import { useTheme } from "#base/themeContext";
import { useFocusChrome, useFocusTaskList } from "#contexts/FocusContext";
import { type ActionBarRow, getContextualShortcutIds } from "#types/actions";
import { type ColumnDefinition } from "./TaskListPanel";
import { buildContextualActionBar } from "#flows/musicDownloadFlow/contextualActions";
import { type MusicDownloadTaskAttributes } from "#flows/musicDownloadFlow/types";
import type { DownloadTask } from "#flows/musicDownloadFlow/utils/downloadTask";
import type { CollectionTask } from "#flows/musicDownloadFlow/utils/collectionTask";
import { Hint } from "../Hint";
import { shortcutRegistry } from "#base/shortcuts/ShortcutRegistry";
import { SettingsStore } from "#settings/settingsStore";
import { getShortcutLiteral } from "#types/actions";
import { fitActions } from "./fitActions";

/** The key(s) of an action as the hint shows them (the live binding), to know how much room the hint takes. */
function literalOf(ids: string[]): string {
    const keybindings = SettingsStore.getInstance().getAppSettings().keybindings;
    return ids
        .map((id) => {
            const resolved = keybindings[id] ?? shortcutRegistry.getDefaultShortcut(id);
            return resolved ? getShortcutLiteral([resolved]) : "";
        })
        .filter(Boolean)
        .join("/");
}

export const ActionBar: React.FC<{
    tasks: Task[];
    columns: ColumnDefinition<MusicDownloadTaskAttributes>[];
    /** Columns the bar may use: a row longer than that is shortened, not cut in the middle of a hint. */
    width: number;
}> = ({ tasks, columns, width }) => {
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
        // `immediate: false`: the bar already reads the task while rendering. The default replays the callback at
        // once, which cost every selection change a second commit (and a second full frame).
        return selectedTask.subscribe(() => setTaskVersion((v) => v + 1), { immediate: false });
    }, [selectedTask]);

    const bar =
        isTaskListActive && selectedTask
            ? buildContextualActionBar(selectedTask as unknown as DownloadTask | CollectionTask, {
                  columns,
                  columnIndex: taskList.selectedColumnIndex,
                  taskIndex: selectedIndex,
                  taskCount: tasks.length,
                  selectedCount: multiCount > 1 ? multiCount : undefined,
                  selectedTasks:
                      multiCount > 1 ? tasks.filter((t) => taskList.selectedTaskIds.has(t.getId())) : undefined,
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
                    // The row's own label and the "›" take room before the first hint.
                    const prefix = (row.text ? [...row.text].length + 1 : 0) + 2;
                    const fitted = fitActions(
                        visible.map((action) => ({
                            label: action.label,
                            literal: literalOf(getContextualShortcutIds(action)),
                        })),
                        // paddingX of the bar, and the prefix
                        width - 2 - prefix
                    );
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
                                <>
                                    {fitted.hints.map(({ index, compact }) => (
                                        <Hint
                                            key={index}
                                            label={visible[index].label}
                                            shortcutIds={getContextualShortcutIds(visible[index])}
                                            compact={compact}
                                        />
                                    ))}
                                    {fitted.more && (
                                        <Box flexShrink={0}>
                                            <Text color={theme.text.hint}>…</Text>
                                        </Box>
                                    )}
                                </>
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
