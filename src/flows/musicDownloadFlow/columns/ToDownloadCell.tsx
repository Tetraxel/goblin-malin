import React from "react";
import { Text, useInput } from "ink";
import { ColumnComponent } from "../../../components/TaskListPanel";
import { DownloadTaskAttributes } from "../types";
import { useWhyDidYouUpdate } from "../../../utils/useWhyDidYouUpdate";

export const ToDownloadCell: ColumnComponent<DownloadTaskAttributes> = ({
  task,
  taskReference,
  width,
  isSelected,
}) => {
  const toDownload = task.attributes?.toDownload ?? false;
  const checkbox = toDownload ? "☒" : "☐";

  useInput((input, key) => {
    if ((key.return || input === " ") && isSelected) {
      taskReference.updateAttributes({ toDownload: !toDownload });
    }
  });

  useWhyDidYouUpdate("ToDownloadCell", {
    task,
    taskReference,
    width,
    isSelected,
  });

  return (
    <Text color={isSelected ? "green" : "white"} bold={toDownload}>
      {checkbox}
    </Text>
  );
};
