import React from "react";
import { Box, Text } from "ink";
import { Task } from "../base/task/task";
import { useTask } from "../hooks/useTask";
import { CalculatedColumn } from "./TaskListPanel";
import { FlowBase } from "../base/flow/flow-base";

export const TaskRow = React.memo(function TaskRow<TAttributes>({
  taskReference,
  isActive,
  isMultiSelected,
  selectedColumnIndex,
  columns,
  flow,
}: {
  taskReference: Task<TAttributes>;
  isActive: boolean;
  isMultiSelected: boolean;
  selectedColumnIndex: number;
  columns: CalculatedColumn<TAttributes>[];
  flow: FlowBase;
}) {
  const task = useTask<TAttributes>(taskReference);

  const isActiveIndicator = isActive ? "☛" : " ";

  const indicator = isActiveIndicator + (isMultiSelected ? "✓" : " ");

  return (
    <Box
      key={task.id}
      paddingX={1}
      overflowY="hidden"
      backgroundColor={isActive ? "#111111" : undefined}
    >
      <Box width={2}>
        <Text color={isActive ? "white" : isMultiSelected ? "cyan" : "white"}>
          {indicator}
        </Text>
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
