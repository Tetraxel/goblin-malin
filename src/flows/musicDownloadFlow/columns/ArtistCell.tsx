import React from "react";
import { Text } from "ink";
import { ColumnComponent } from "../../../components/TaskListPanel";
import { DownloadTaskAttributes } from "../utils/downloadTask";

export const ArtistCell: ColumnComponent<DownloadTaskAttributes> = ({
  task,
  width,
  isSelected,
}) => {
  const artist = task.attributes?.track?.artists?.[0]?.name || "";

  return (
    <Text
      color={isSelected ? "green" : "white"}
      underline={isSelected}
      wrap="truncate-end"
    >
      {artist}
    </Text>
  );
};
