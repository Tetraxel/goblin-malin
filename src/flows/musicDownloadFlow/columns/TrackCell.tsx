import React from "react";
import { Text } from "ink";
import { ColumnComponent } from "../../../components/TaskListPanel";
import { MusicDownloadTaskAttributes } from "../types";
import { useWhyDidYouUpdate } from "../../../utils/useWhyDidYouUpdate";

export const TrackCell: ColumnComponent<MusicDownloadTaskAttributes> = ({
  task,
  width,
  isSelected,
}) => {
  const primaryMetadata = task.attributes?.metadataSources?.find(
    (source) => source.metadata.isPrimarySource,
  )?.metadata;
  const trackName = primaryMetadata?.trackName || "";

  useWhyDidYouUpdate("TrackCell", {
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
      {trackName}
    </Text>
  );
};
