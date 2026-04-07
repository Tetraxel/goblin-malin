import React from "react";
import { Box, Text, useInput } from "ink";
import { Task } from "../base/task/task";
import { useTask } from "../hooks/useTask";
import { CalculatedColumn } from "./TaskListPanel";
import { useFocusContext } from "../contexts/FocusContext";
import { FlowBase } from "../base/flow/flow-base";
import { globalLogger } from "../base/logger/logger";
import { useWhyDidYouUpdate } from "../utils/useWhyDidYouUpdate";

export const TaskRow = React.memo(function TaskRow<TAttributes>({
  taskReference,
  isActive,
  selectedColumnIndex,
  columns,
  flow,
}: {
  taskReference: Task<TAttributes>;
  isActive: boolean;
  selectedColumnIndex: number;
  columns: CalculatedColumn<TAttributes>[];
  flow: FlowBase;
}) {
  const task = useTask<TAttributes>(taskReference);

  useInput(
    (input, key) => {
      if (task && input === "r") flow.restartTask(taskReference);
    },
    { isActive },
  );

  useWhyDidYouUpdate(`TaskRow ${task?.id || "unknown"}`, {
    task: task ? { ...task } : null, // Avoid deep comparison of details
    isActive,
    columns: columns.map((col) => ({
      label: col.label,
      width: col.width,
      flexGrow: col.flexGrow,
    })),
    flowId: flow.id,
  });

  return (
    <Box key={task.id} paddingX={1} overflowY="hidden">
      <Box width={2}>
        <Text color="white">{isActive ? "☛ " : "  "}</Text>
      </Box>
      {columns.map((column, index) => {
        const CellComponent = column.component;
        const isCellActive = isActive && selectedColumnIndex === index;
        return (
          <Box
            key={`${CellComponent.name}-${column.label}-${index}`}
            width={column.width}
            height={1}
            flexGrow={column.flexGrow}
            overflow="hidden"
            paddingX={1}
            backgroundColor={isCellActive ? "gray" : undefined}
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
