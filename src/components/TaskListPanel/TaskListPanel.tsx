import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { TaskRow } from "./TaskRow";
import { Task, TaskSnapshot } from "../../base/task/task";
import { useFocusContext } from "../../contexts/FocusContext";
import { FlowBase } from "../../base/flow/flow-base";
import { globalLogger } from "../../base/logger/logger";
import {
  Shortcut,
  ContextualActions,
  ContextualActionBar,
} from "../../types/actions";
import { useTheme } from "../../base/themeContext";
import { ActionBar } from "./ActionBar";

export type { Shortcut, ContextualActions, ContextualActionBar };

export type ColumnComponent<TAttributes> = ({
  task,
  width,
  isSelected,
  flow,
}: {
  task: TaskSnapshot<TAttributes>;
  taskReference: Task<TAttributes>;
  width: number;
  isSelected: boolean;
  flow: FlowBase;
}) => React.ReactNode;

export type ColumnDefinition<TAttributes = any> = {
  id: string;
  label: string;
  color?: React.ComponentProps<typeof Text>["color"];
  weight: number;
  minWidth?: number;
  flexGrow?: number;
  component: ColumnComponent<TAttributes>;
};

export type CalculatedColumn<TAttributes = any> =
  ColumnDefinition<TAttributes> & {
    width: number;
  };

export function calculateColumnWidths<TAttributes>(
  columns: ColumnDefinition<TAttributes>[],
  totalWidth: number,
): CalculatedColumn<TAttributes>[] {
  const reservedWidth = 3; // " ☛✓ " indicator
  const availableWidth = totalWidth - reservedWidth;

  const columnsWithMin = columns.map((col) => ({
    ...col,
    minWidth: col.minWidth ?? Math.max(2, col.label.length + 3),
  }));

  const totalWeight = columnsWithMin.reduce((sum, col) => sum + col.weight, 0);
  const totalMinWidth = columnsWithMin.reduce(
    (sum, col) => sum + col.minWidth!,
    0,
  );

  const remainingWidth = availableWidth - totalMinWidth;

  const columnsWithBase = columnsWithMin.map((col) => {
    const baseWidth = col.minWidth!;
    const weightRatio = col.weight / totalWeight;
    const additionalWidth = Math.floor(remainingWidth * weightRatio);

    return {
      ...col,
      baseWidth: baseWidth + additionalWidth,
      hasFlexGrow: (col.flexGrow ?? 0) > 0,
    };
  });

  const usedWidth = columnsWithBase.reduce(
    (sum, col) => sum + col.baseWidth,
    0,
  );
  const leftoverWidth = availableWidth - usedWidth;

  const totalFlexGrow = columnsWithBase
    .filter((col) => col.hasFlexGrow)
    .reduce((sum, col) => sum + (col.flexGrow ?? 0), 0);

  return columnsWithBase.map((col) => {
    let width = col.baseWidth;

    if (col.hasFlexGrow && totalFlexGrow > 0 && leftoverWidth > 0) {
      const flexRatio = (col.flexGrow ?? 0) / totalFlexGrow;
      width += Math.floor(leftoverWidth * flexRatio);
    }

    return {
      id: col.id,
      label: col.label,
      weight: col.weight,
      color: col.color,
      minWidth: col.minWidth,
      flexGrow: col.flexGrow,
      component: col.component,
      width,
    };
  });
}

export const TaskListPanel: React.FC<{
  columns: ColumnDefinition[];
  tasks: Task<any>[];
  width: number;
  flow: FlowBase;
}> = ({ columns, tasks, width, flow }) => {
  const theme = useTheme();
  const { focusState } = useFocusContext();
  const isWindowActive = focusState.activeWindow === "taskList";
  const fullHeight = focusState.layout.taskListHeight;
  const actionBarRows = isWindowActive ? 2 : 0;
  const height = fullHeight - 1 - actionBarRows; // subtract header and action bar

  // Calculate scroll offset so the selected task stays visible (center when possible)
  const selectedIndex = focusState.taskList.selectedTaskIndex;
  const taskCount = tasks.length;
  const maxOffset = Math.max(0, taskCount - height);

  // Center using (height - 1)/2 to avoid off-by-one shifts for even heights,
  // then clamp to [0, maxOffset].
  const desiredCenterOffset = selectedIndex - Math.floor((height - 1) / 2);
  const offset = Math.max(0, Math.min(desiredCenterOffset, maxOffset));

  const calculatedColumns = useMemo(
    () => calculateColumnWidths(columns, width),
    [columns, width],
  );

  return (
    <Box
      borderStyle="single"
      borderColor={theme.ui.border}
      borderBackgroundColor={theme.ui.background}
      flexDirection="column"
      overflow="hidden"
      borderTop={false}
      borderBottom={false}
      height={fullHeight}
      flexGrow={1}
    >
      {/* Column headers */}
      <Box
        flexDirection="row"
        paddingX={1}
        height={1}
        overflow="hidden"
        flexShrink={0}
      >
        <Box width={2} height={1} flexShrink={0} />
        {calculatedColumns.map((column, index) => (
          <Box
            key={`header-${column.label}-${index}`}
            width={column.width}
            height={1}
            paddingX={1}
            overflow="hidden"
            flexShrink={0}
          >
            <Text bold color={column.color || "cyan"}>
              {column.label}
            </Text>
          </Box>
        ))}
      </Box>

      {/* Task rows */}
      <Box
        flexDirection="column"
        height={height}
        overflow="hidden"
        flexGrow={1}
      >
        {tasks.length === 0 ? (
          <Box paddingX={4} overflow="hidden">
            <Text italic color={"gray"}>
              Press Ctrl+V to import music URLs
            </Text>
          </Box>
        ) : (
          tasks.slice(offset, offset + height).map((task, index) => {
            const visibleIndex = index + offset;
            const isRowHighlighted = selectedIndex === visibleIndex;
            const isRowActive =
              isWindowActive && selectedIndex === visibleIndex;
            const selectedColumnIndex = isRowActive
              ? focusState.taskList.selectedColumnIndex
              : -1;
            const isMultiSelected = focusState.taskList.selectedTaskIds.has(
              task.getId(),
            );
            return (
              <TaskRow
                key={task.getId()}
                taskReference={task}
                isHighlighted={isRowHighlighted}
                isActive={isRowActive}
                isMultiSelected={isMultiSelected}
                selectedColumnIndex={selectedColumnIndex}
                columns={calculatedColumns}
                flow={flow}
              />
            );
          })
        )}
      </Box>

      {/* Shortcut hints */}
      <ActionBar tasks={tasks} flow={flow} />
    </Box>
  );
};
