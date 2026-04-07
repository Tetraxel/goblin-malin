import React from "react";
import { Text } from "ink";
import { ColumnComponent } from "../../../components/TaskListPanel";
import { DownloadTaskAttributes } from "../types";
import { useWhyDidYouUpdate } from "../../../utils/useWhyDidYouUpdate";

export const UrlCell: ColumnComponent<DownloadTaskAttributes> = ({
  task,
  width,
  isSelected,
}) => {
  const track = task.attributes?.track;
  const url = track?.uri ?? track?.url ?? task.initialInput ?? "";

  useWhyDidYouUpdate("UrlCell", {
    task,
    width,
    isSelected,
  });

  return (
    <Text
      color={isSelected ? "green" : "white"}
      underline={isSelected}
      wrap="truncate-end"
    >
      {url}
    </Text>
  );
};
