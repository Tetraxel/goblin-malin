import React from "react";
import { Text, useInput } from "ink";
import { ColumnComponent } from "../../../components/TaskListPanel";
import { DownloadTaskAttributes } from "../types";
import { useWhyDidYouUpdate } from "../../../utils/useWhyDidYouUpdate";

export const ToTagCell: ColumnComponent<DownloadTaskAttributes> = ({
  task,
  taskReference,
  width,
  isSelected,
}) => {
  const toTag = task.attributes?.toTag ?? false;
  const checkbox = toTag ? "☒" : "☐";

  useInput((input, key) => {
    if ((key.return || input === " ") && isSelected) {
      taskReference.updateAttributes({ toTag: !toTag });
    }
  });

  useWhyDidYouUpdate("ToTagCell", {
    task,
    taskReference,
    width,
    isSelected,
  });

  return (
    <Text color={isSelected ? "green" : "white"} bold={toTag}>
      {checkbox}
    </Text>
  );
};
