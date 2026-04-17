import React, { useMemo } from "react";
import { Box, Key, Text, useInput } from "ink";
import { TaskRow } from "./TaskRow";
import { Task, TaskSnapshot } from "../base/task/task";
import { useFocusContext } from "../contexts/FocusContext";
import { FlowBase } from "../base/flow/flow-base";
import { globalLogger } from "../base/logger/logger";
import { useWhyDidYouUpdate } from "../utils/useWhyDidYouUpdate";

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

export type Shortcut = {
  key?: keyof Key;
  input?: string;
};

export type ContextualActions = {
  shortcuts: Shortcut[];
  label: string;
  description?: string;
  color?: React.ComponentProps<typeof Text>["color"];
  onClick: () => void;
};

export type ContextualActionBar = {
  text?: string;
  textColor?: React.ComponentProps<typeof Text>["color"];
  actions: ContextualActions[];
};

export type CalculatedColumn<TAttributes = any> =
  ColumnDefinition<TAttributes> & {
    width: number;
  };

function getShortcutLiteral(shortcuts: Shortcut[]): string {
  return shortcuts
    .map((shortcut) => {
      const keyName = shortcut.key ? `${shortcut.key.toUpperCase()}` : "";
      const inputName = shortcut.input
        ? shortcut.input === " "
          ? "SPACE"
          : `${shortcut.input.toUpperCase()}`
        : "";

      if (keyName && inputName) return `${keyName} + ${inputName}`;
      return keyName || inputName || "";
    })
    .join(" / ");
}

export function calculateColumnWidths<TAttributes>(
  columns: ColumnDefinition<TAttributes>[],
  totalWidth: number,
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
    0,
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
    0,
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
  tasks: Task[];
  width: number;
  flow: FlowBase;
}> = ({ columns, tasks, width, flow }) => {
  const { focusState, ...focusManager } = useFocusContext();
  const isWindowActive = focusState.activeWindow === "taskList";
  const fullHeight = focusState.taskList.height;
  const height = fullHeight - 2; // substract the header height + contextual actions row

  // Calculate scroll offset so the selected task stays visible (center when possible)
  const selectedIndex = focusState.taskList.selectedTaskIndex;
  const taskCount = tasks.length;
  const maxOffset = Math.max(0, taskCount - height);

  // Center using (height - 1)/2 to avoid off-by-one shifts for even heights,
  // then clamp to [0, maxOffset].
  const desiredCenterOffset = selectedIndex - Math.floor((height - 1) / 2);
  const offset = Math.max(0, Math.min(desiredCenterOffset, maxOffset));

  const contextualActionBar = useMemo(() => {
    if (isWindowActive && tasks[selectedIndex]) {
      return flow.getContextualActionBar(tasks[selectedIndex], {
        columnIndex: focusState.taskList.selectedColumnIndex,
      });
    }
    return null;
  }, [
    isWindowActive,
    tasks,
    selectedIndex,
    flow,
    focusState.taskList.selectedColumnIndex,
  ]);

  useInput(
    (input, key) => {
      // Handle navigation and resizing shortcuts
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

      // Handle contextual action shortcuts
      if (contextualActionBar) {
        const matchingAction = contextualActionBar.actions.find((action) => {
          // Check if any shortcut in the array matches
          return action.shortcuts.some((shortcut) => {
            globalLogger.info(`'${key.ctrl}' '${input}'`);
            // Check if input matches
            if (shortcut.input === input) {
              globalLogger.info(`matched input '${input}'`);
              return true;
            }
            // Check if key matches (need to check if the key property is pressed)
            if (shortcut.key) {
              const keyName = shortcut.key;
              if (
                (keyName === "upArrow" && key.upArrow) ||
                (keyName === "downArrow" && key.downArrow) ||
                (keyName === "leftArrow" && key.leftArrow) ||
                (keyName === "rightArrow" && key.rightArrow) ||
                (keyName === "pageDown" && key.pageDown) ||
                (keyName === "pageUp" && key.pageUp) ||
                (keyName === "home" && key.home) ||
                (keyName === "end" && key.end) ||
                (keyName === "return" && key.return) ||
                (keyName === "escape" && key.escape) ||
                (keyName === "ctrl" && key.ctrl) ||
                (keyName === "shift" && key.shift) ||
                (keyName === "tab" && key.tab) ||
                (keyName === "backspace" && key.backspace) ||
                (keyName === "delete" && key.delete) ||
                (keyName === "meta" && key.meta)
              ) {
                globalLogger.info(`matched key '${keyName}'`);
                return true;
              }
            }
            return false;
          });
        });
        if (matchingAction) {
          matchingAction.onClick();
        }
      }
    },
    { isActive: isWindowActive },
  );

  const calculatedColumns = useMemo(
    () => calculateColumnWidths(columns, width),
    [columns, width],
  );

  globalLogger.info("--- TaskListPanel Render ---");

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
      {/* headers */}
      <Box paddingX={1} height={1} overflow="hidden">
        <Box width={2} height={1} />
        {calculatedColumns.map((column, index) => {
          return (
            <Box
              key={`header-${column.label}-${index}`}
              width={column.width}
              height={1}
              paddingX={1}
              overflow="hidden"
              // minWidth={column.minWidth}
              // flexGrow={column?.flexGrow}
            >
              <Text bold color={column.color || "cyan"}>
                {column.label}
              </Text>
            </Box>
          );
        })}
      </Box>

      {/* Task Rows */}
      <Box flexDirection="column" height={height} overflow="hidden">
        {tasks.slice(offset, offset + height).map((task, index) => {
          const visibleIndex = index + offset;
          const isRowActive = isWindowActive && selectedIndex === visibleIndex;
          const selectedColumnIndex = isRowActive
            ? focusState.taskList.selectedColumnIndex
            : -1;
          return (
            <TaskRow
              key={task.getId()}
              taskReference={task}
              isActive={isWindowActive && selectedIndex === visibleIndex}
              selectedColumnIndex={selectedColumnIndex}
              columns={calculatedColumns}
              flow={flow}
            />
          );
        })}
      </Box>

      {/* Contextual Actions */}
      <Box paddingX={1} height={1} overflow="hidden">
        {contextualActionBar ? (
          <>
            {contextualActionBar.text && (
              <Box marginRight={2}>
                <Text
                  color={contextualActionBar.textColor || "white"}
                  bold={true}
                >
                  {contextualActionBar.text}
                </Text>
              </Box>
            )}
            {contextualActionBar.actions.map((action, index) => (
              <Box key={`context-${action.label}-${index}`} marginRight={2}>
                <Text
                  color={action.color ? action.color : "white"}
                >{`[${getShortcutLiteral(action.shortcuts)}] ${action.label}`}</Text>
              </Box>
            ))}
          </>
        ) : (
          <Text color="gray" italic={true}>
            No contextual actions available
          </Text>
        )}
      </Box>
    </Box>
  );
};
