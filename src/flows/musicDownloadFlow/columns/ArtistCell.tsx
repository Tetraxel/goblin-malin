import React from "react";
import { Text } from "ink";
import { ColumnComponent } from "../../../components/TaskListPanel";
import { MusicDownloadTaskAttributes } from "../types";

export const ArtistCell: ColumnComponent<MusicDownloadTaskAttributes> = ({
  task,
  width,
  isSelected,
}) => {
  const primaryMetadata = task.attributes?.metadataSources?.find(
    (source) => source.metadata.isPrimarySource,
  )?.metadata;
  const artist = primaryMetadata?.artists?.[0]?.name || "";

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
