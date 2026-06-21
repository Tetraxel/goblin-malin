import React from "react";
import { Box, Text } from "ink";
import { Task } from "#base/task/task";
import { FlowBase } from "#base/flow/flow-base";
import { Theme } from "#base/theme";
import { useTheme } from "#base/themeContext";
import { useTask } from "#hooks/useTask";
import { CalculatedColumn } from "./TaskListPanel";

function getRowBackground(
    theme: Theme,
    isActive: boolean,
    isHighlighted: boolean,
    isMultiSelected: boolean
): string | undefined {
    if (isActive)
        return isMultiSelected ? theme.ui.rowMultiSelectedActiveBackground : theme.ui.rowActiveDimmedBackground;
    if (isHighlighted || isMultiSelected)
        return isMultiSelected ? theme.ui.rowMultiSelectedBackground : theme.ui.rowBackground;
    return undefined;
}

export const TaskRow = React.memo(function TaskRow<TAttributes>({
    taskReference,
    isActive,
    isHighlighted,
    isMultiSelected,
    selectedColumnIndex,
    columns,
    flow,
}: {
    taskReference: Task<TAttributes>;
    isActive: boolean;
    isMultiSelected: boolean;
    isHighlighted: boolean;
    selectedColumnIndex: number;
    columns: CalculatedColumn<TAttributes>[];
    flow: FlowBase;
}) {
    const theme = useTheme();
    const task = useTask<TAttributes>(taskReference);

    const isActiveIndicator = isActive ? "☛" : " ";
    const indicator = isActiveIndicator + (isMultiSelected ? "✓" : " ");
    const backgroundColor = getRowBackground(theme, isActive, isHighlighted, isMultiSelected);

    return (
        <Box key={task.id} paddingX={1} overflowY="hidden" backgroundColor={backgroundColor}>
            <Box width={2} flexShrink={0}>
                <Text color={isActive ? "white" : isMultiSelected ? "cyan" : "white"}>{indicator}</Text>
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
                                    ? theme.ui.rowMultiSelectedCellActiveBackground
                                    : theme.ui.rowActiveBackground
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
                            flow={flow}
                        />
                    </Box>
                );
            })}
        </Box>
    );
});
