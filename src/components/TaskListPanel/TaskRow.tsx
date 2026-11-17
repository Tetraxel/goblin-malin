import React from "react";
import { Box, Text } from "ink";
import { type Task } from "#base/task/task";
import { type Theme } from "#base/theme";
import { useTheme } from "#base/themeContext";
import { useTask } from "#hooks/useTask";
import { useTaskLocked } from "#hooks/useTaskLocked";
import { CHAT_AGENT_COLOR } from "../ChatPanel/chatPanelState";
import { type CalculatedColumn, type PlaybackState } from "./TaskListPanel";

function getRowBackground(
    theme: Theme,
    isActive: boolean,
    isHighlighted: boolean,
    isMultiSelected: boolean
): string | undefined {
    // focus is on the window and the current row is active
    if (isActive)
        return isMultiSelected
            ? theme.ui.rowBackground.multiSelected.activeDimmed
            : theme.ui.rowBackground.regular.activeDimmed;
    // focus is not on the window, but the current row is highlighted
    if (isHighlighted)
        return isMultiSelected
            ? theme.ui.rowBackground.multiSelected.highlighted
            : theme.ui.rowBackground.regular.highlighted;
    if (isMultiSelected) return theme.ui.rowBackground.multiSelected.base;
    return undefined;
}

export const TaskRow = React.memo(function TaskRow<TAttributes>({
    taskReference,
    isActive,
    isHighlighted,
    isMultiSelected,
    selectedColumnIndex,
    playback,
    columns,
}: {
    taskReference: Task<TAttributes>;
    playback?: PlaybackState;
    isActive: boolean;
    isMultiSelected: boolean;
    isHighlighted: boolean;
    selectedColumnIndex: number;
    columns: CalculatedColumn<TAttributes>[];
}) {
    const theme = useTheme();
    const task = useTask<TAttributes>(taskReference);

    // Claude is changing this task right now: it is greyed, with the agent's glyph where the tick goes. Static on
    // purpose (like the chat's "working" line): a lease can last minutes, and an animation would repaint the whole
    // screen several times a second for all that time.
    const locked = useTaskLocked(task.id);

    const isActiveIndicator = isActive ? "☛" : " ";
    const backgroundColor =
        getRowBackground(theme, isActive, isHighlighted, isMultiSelected) ??
        (locked ? theme.ui.rowBackground.regular.highlighted : undefined);

    return (
        <Box key={task.id} paddingX={1} overflowY="hidden" backgroundColor={backgroundColor}>
            <Box width={2} flexShrink={0}>
                <Text color={isActive ? "white" : isMultiSelected ? "cyan" : "white"}>
                    {isActiveIndicator}
                    {locked ? <Text color={CHAT_AGENT_COLOR}>✻</Text> : isMultiSelected ? "✓" : " "}
                </Text>
            </Box>
            {columns.map((column, index) => {
                const CellComponent = column.component;
                const isCellActive = isActive && selectedColumnIndex === index;
                return (
                    <Box
                        key={`${CellComponent.name}-${column.label}-${index}`}
                        width={column.width}
                        minWidth={column.width}
                        maxWidth={column.width}
                        height={1}
                        flexGrow={column.flexGrow}
                        flexShrink={0}
                        paddingX={1}
                        backgroundColor={
                            isCellActive
                                ? isMultiSelected
                                    ? theme.ui.rowBackground.multiSelected.cellActive
                                    : theme.ui.rowBackground.regular.cellActive
                                : isMultiSelected
                                  ? backgroundColor
                                  : undefined
                        }
                        overflow="hidden"
                    >
                        <CellComponent
                            task={task}
                            taskReference={taskReference}
                            width={column.width}
                            isSelected={isCellActive}
                            playback={playback}
                        />
                    </Box>
                );
            })}
        </Box>
    );
});
