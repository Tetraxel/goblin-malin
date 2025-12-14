import React from "react";
import { Box, Text } from "ink";
import { Task } from "../base/task/task";
import { useTask } from "../hooks/useTask";
import { CalculatedColumn } from "./TaskListPanel";
import { useFocusContext } from "../contexts/FocusContext";

export const TaskRow = <TAttributes,>({
  taskReference,
  isActive,
  columns,
}: {
  taskReference: Task<TAttributes>;
  isActive: boolean;
  columns: CalculatedColumn<TAttributes>[];
}) => {
  const { focusState } = useFocusContext();
  const task = useTask<TAttributes>(taskReference);

  return (
    <Box key={task.id} paddingX={1} overflowY="hidden">
      <Box width={2}>
        <Text color={isActive ? "green" : "white"}>
          {isActive ? "☛ " : "  "}
        </Text>
      </Box>
      {columns.map((column, index) => (
        <Box
          key={`${column.label}-${index}`}
          width={column.width}
          height={1}
          flexGrow={column.flexGrow}
          overflow="hidden"
          paddingX={1}
        >
          {column.render({
            task,
            width: column.width,
            isSelected:
              isActive && focusState.taskList.selectedColumnIndex === index,
          })}
        </Box>
      ))}
    </Box>
  );
};
