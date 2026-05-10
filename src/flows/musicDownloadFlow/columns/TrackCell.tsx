import React from "react";
import { Text } from "ink";
import { ColumnComponent } from "../../../components/TaskListPanel";
import { MusicDownloadTaskAttributes } from "../types";
import { computeCompiledMetadata } from "../utils/compiledMetadata";

export const TrackCell: ColumnComponent<MusicDownloadTaskAttributes> = ({
  task,
  width,
  isSelected,
}) => {
  const sources = task.attributes?.metadataSources ?? [];
  const overrides = task.attributes?.metadataOverride ?? {};
  const compiled = computeCompiledMetadata(sources, overrides);
  const trackName = compiled.trackName;

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
