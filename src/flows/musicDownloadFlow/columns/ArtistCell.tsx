import React from "react";
import { Text } from "ink";
import { ColumnComponent } from "../../../components/TaskListPanel";
import { MusicDownloadTaskAttributes } from "../types";
import { useWhyDidYouUpdate } from "../../../utils/useWhyDidYouUpdate";

export const ArtistCell: ColumnComponent<MusicDownloadTaskAttributes> = ({
  task,
  width,
  isSelected,
}) => {
  const primaryMetadata = task.attributes?.metadataSources?.find(
    (m) => m.isPrimarySource,
  );
  const artist = primaryMetadata?.artists?.[0]?.name || "";

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
