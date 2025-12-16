import React from "react";
import { Text } from "ink";
import { ColumnComponent } from "../../../components/TaskListPanel";
import { DownloadTaskAttributes } from "../utils/downloadTask";

export const TrackCell: ColumnComponent<DownloadTaskAttributes> = ({
  task,
  width,
  isSelected,
}) => {
  const trackName = task.attributes?.track?.trackName || "";

  return (
    <Text
      color={isSelected ? "green" : "white"}
      underline={isSelected}
      wrap="truncate-end"
    >
      {trackName}
    </Text>
  );
};
