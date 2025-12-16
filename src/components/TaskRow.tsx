import React from "react";
import { Box, Text } from "ink";
import { Task } from "../base/task/task";
import { useTask } from "../hooks/useTask";
import { CalculatedColumn } from "./TaskListPanel";
import { useFocusContext } from "../contexts/FocusContext";
import { FlowBase } from "../base/flow/flow-base";

export const TaskRow = <TAttributes,>({
  taskReference,
  isActive,
  columns,
  flow,
}: {
  taskReference: Task<TAttributes>;
  isActive: boolean;
  columns: CalculatedColumn<TAttributes>[];
  flow: FlowBase;
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
      {columns.map((column, index) => {
        return (
          <Box
            key={`${column.label}-${index}`}
            width={column.width}
            height={1}
            flexGrow={column.flexGrow}
            overflow="hidden"
            paddingX={1}
          >
            {column.component({
              task,
              width: column.width,
              isSelected:
                isActive && focusState.taskList.selectedColumnIndex === index,
              flow,
            })}
          </Box>
        );
      })}
    </Box>
  );
};
