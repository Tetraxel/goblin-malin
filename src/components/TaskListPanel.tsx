import React from "react";
import { Box, Text, useInput } from "ink";
import { TaskRow } from "./TaskRow";
import { Task, TaskSnapshot } from "../base/task/task";
import { useFocusContext } from "../contexts/FocusContext";
import { FlowBase } from "../base/flow/flow-base";
import { globalLogger } from "../base/logger/logger";

export type ColumnComponent<TAttributes> = ({
  task,
  width,
  isSelected,
  flow,
}: {
  task: TaskSnapshot<TAttributes>;
  width: number;
  isSelected: boolean;
  flow: FlowBase;
}) => React.ReactNode;

export type ColumnDefinition<TAttributes = any> = {
  label: string;
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
  totalWidth: number
): CalculatedColumn<TAttributes>[] {
  // Account for selection indicator and padding
  const reservedWidth = 2; // "☛ " indicator
  const availableWidth = totalWidth - reservedWidth;

  const columnsWithMin = columns.map((col) => ({
    ...col,
    minWidth: col.minWidth ?? Math.max(2, col.label.length + 3),
  }));

  const totalWeight = columnsWithMin.reduce((sum, col) => sum + col.weight, 0);
  const totalMinWidth = columnsWithMin.reduce(
    (sum, col) => sum + col.minWidth!,
    0
  );

  let remainingWidth = availableWidth - totalMinWidth;

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
    0
  );
  let leftoverWidth = availableWidth - usedWidth;

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
      label: col.label,
      weight: col.weight,
      minWidth: col.minWidth,
      flexGrow: col.flexGrow,
      component: col.component,
      width,
    };
  });
}

export const TaskListPanel: React.FC<{
  columns: ColumnDefinition[];
  tasks: Task[];
  width: number;
  flow: FlowBase;
}> = ({ columns, tasks, width, flow }) => {
  const { focusState, ...focusManager } = useFocusContext();
  const isActive = focusState.activeWindow === "taskList";
  const fullHeight = focusState.taskList.height;
  const height = fullHeight - 1; // substract the header height

  useInput(
    (input, key) => {
      if (key.upArrow) {
        if (key.shift) focusManager.resizeTaskList("up");
        else focusManager.moveTaskSelection("up");
      }
      if (key.downArrow) {
        if (key.shift) focusManager.resizeTaskList("down");
        else focusManager.moveTaskSelection("down");
      }
      if (key.leftArrow) focusManager.moveTaskSelection("left");
      if (key.rightArrow) focusManager.moveTaskSelection("right");
    },
    { isActive }
  );

  const calculatedColumns = calculateColumnWidths(columns, width);

  // Calculate scroll offset so the selected task stays visible (center when possible)
  const selectedIndex = focusState.taskList.selectedTaskIndex;
  const taskCount = tasks.length;
  const maxOffset = Math.max(0, taskCount - height);

  // Center using (height - 1)/2 to avoid off-by-one shifts for even heights,
  // then clamp to [0, maxOffset].
  const desiredCenterOffset = selectedIndex - Math.floor((height - 1) / 2);
  const offset = Math.max(0, Math.min(desiredCenterOffset, maxOffset));

  return (
    <Box
      borderStyle="single"
      borderColor="cyan"
      flexDirection="column"
      overflow="hidden"
      borderTop={false}
      borderBottom={false}
      height={fullHeight}
    >
      <Box paddingX={1} height={1} overflow="hidden">
        <Box width={2} height={1} />
        {calculatedColumns.map((column, index) => (
          <Box
            key={`header-${column.label}-${index}`}
            width={column.width}
            height={1}
            paddingX={1}
            overflow="hidden"
            // minWidth={column.minWidth}
            // flexGrow={column?.flexGrow}
          >
            <Text bold color="cyan">
              {column.label}
            </Text>
          </Box>
        ))}
      </Box>

      {/* Task Rows */}
      <Box flexDirection="column" height={height} overflow="hidden">
        {tasks.slice(offset, offset + height).map((task, index) => {
          const visibleIndex = index + offset;
          return (
            <TaskRow
              key={task.getId()}
              taskReference={task}
              isActive={
                isActive &&
                focusState.taskList.selectedTaskIndex === visibleIndex
              }
              columns={calculatedColumns}
              flow={flow}
            />
          );
        })}
      </Box>
    </Box>
  );
};
