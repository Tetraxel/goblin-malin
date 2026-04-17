import React from "react";
import { Text } from "ink";
import { ColumnComponent } from "../../../../components/TaskListPanel";
import { MusicDownloadTaskAttributes } from "../../types";

export const SpotifyCell: ColumnComponent<MusicDownloadTaskAttributes> = ({
  task,
  width,
  isSelected,
}) => {
  const metadata = task.attributes?.metadataSources.find(
    (m) => m.apiProvider === "spotify",
  );
  const fullUri = metadata?.uri;
  const uri = fullUri?.split("::").pop();

  return (
    <Text
      color={uri ? "green" : "white"}
      underline={isSelected}
      wrap="truncate-end"
    >
      {uri || ""}
    </Text>
  );
};
