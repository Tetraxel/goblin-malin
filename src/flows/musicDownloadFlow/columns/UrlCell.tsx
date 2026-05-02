import React from "react";
import { Text } from "ink";
import { ColumnComponent } from "../../../components/TaskListPanel";
import { MusicDownloadTaskAttributes } from "../types";
import { useWhyDidYouUpdate } from "../../../utils/useWhyDidYouUpdate";

export const UrlCell: ColumnComponent<MusicDownloadTaskAttributes> = ({
  task,
  width,
  isSelected,
}) => {
  const primaryMetadata = task.attributes?.metadataSources.find(
    (source) =>
      source.metadata.isPrimarySource &&
      (source.metadata.url || source.metadata.uri),
  )?.metadata;
  const url =
    primaryMetadata?.uri ?? primaryMetadata?.url ?? task.initialInput ?? "";

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
