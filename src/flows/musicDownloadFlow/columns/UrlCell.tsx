import React from "react";
import { Text } from "ink";
import { ColumnComponent } from "../../../components/TaskListPanel/TaskListPanel";
import { MusicDownloadTaskAttributes } from "../types";

export const UrlCell: ColumnComponent<MusicDownloadTaskAttributes> = ({
  task,
  width,
  isSelected,
}) => {
  const primaryMetadata = task.attributes?.metadataSources.find(
    (source) =>
      source.isPrimarySource &&
      (source.metadata.url || source.metadata.uri),
  )?.metadata;
  const url =
    primaryMetadata?.uri ?? primaryMetadata?.url ?? task.initialInput ?? "";

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
