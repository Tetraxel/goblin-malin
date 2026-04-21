import React from "react";
import { Text } from "ink";
import { ColumnComponent } from "../../../components/TaskListPanel";
import { MusicDownloadTaskAttributes } from "../types";
import { useWhyDidYouUpdate } from "../../../utils/useWhyDidYouUpdate";

export const ToDownloadCell: ColumnComponent<MusicDownloadTaskAttributes> = ({
  task,
  taskReference,
  width,
  isSelected,
}) => {
  const toDownload = task.attributes?.toDownload ?? false;
  const checkbox = toDownload ? "☒" : "☐";

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
