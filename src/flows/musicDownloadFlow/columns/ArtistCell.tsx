import React from "react";
import { Text } from "ink";
import { ColumnComponent } from "../../../components/TaskListPanel";
import { DownloadTaskAttributes } from "../types";
import { useWhyDidYouUpdate } from "../../../utils/useWhyDidYouUpdate";

export const ArtistCell: ColumnComponent<DownloadTaskAttributes> = ({
  task,
  width,
  isSelected,
}) => {
  const artist = task.attributes?.track?.artists?.[0]?.name || "";

  useWhyDidYouUpdate("ArtistCell", {
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
      {artist}
    </Text>
  );
};
