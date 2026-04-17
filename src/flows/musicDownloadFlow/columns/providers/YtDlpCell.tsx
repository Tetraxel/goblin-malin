import React from "react";
import { Text } from "ink";
import { ColumnComponent } from "../../../../components/TaskListPanel";
import { MusicDownloadTaskAttributes } from "../../types";

export const YtDlpCell: ColumnComponent<MusicDownloadTaskAttributes> = ({
  task,
  width,
  isSelected,
}) => {
  const downloadSource = task.attributes?.downloadSources.find(
    (d) => d.provider === "ytdlp",
  );
  const display =
    downloadSource?.localFile?.name || downloadSource?.state || "";

  return (
    <Text
      color={downloadSource?.state === "downloaded" ? "green" : "white"}
      underline={isSelected}
      wrap="truncate-end"
    >
      {display}
    </Text>
  );
};
