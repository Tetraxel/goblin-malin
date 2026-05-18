import React from "react";
import { Text } from "ink";
import { ColumnComponent } from "../../../components/TaskListPanel/TaskListPanel";
import { MusicDownloadTaskAttributes } from "../types";

export const ToDownloadCell: ColumnComponent<MusicDownloadTaskAttributes> = ({
  task,
  isSelected,
}) => {
  const toDownload = task.attributes?.toDownload ?? false;
  const checkbox = toDownload ? "☒" : "☐";

  return (
    <Text color={isSelected ? "green" : "white"} bold={toDownload}>
      {checkbox}
    </Text>
  );
};
