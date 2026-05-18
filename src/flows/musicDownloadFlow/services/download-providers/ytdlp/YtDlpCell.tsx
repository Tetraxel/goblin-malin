import React from "react";
import path from "path";
import { Text } from "ink";
import { ColumnComponent } from "../../../../../components/TaskListPanel/TaskListPanel";
import { MusicDownloadTaskAttributes } from "../../../types";

export const YtDlpCell: ColumnComponent<MusicDownloadTaskAttributes> = ({
  task,
  isSelected,
}) => {
  const downloadSource = task.attributes?.downloadSources.find(
    (d) => d.provider === "ytdlp",
  );
  const saved = downloadSource?.savedFile;
  const display = saved
    ? path.basename(saved.path)
    : (downloadSource?.localFile?.name ?? downloadSource?.state ?? "");

  const color = saved
    ? "cyan"
    : downloadSource?.state === "downloaded"
      ? "green"
      : "white";

  return (
    <Text color={color} underline={isSelected} wrap="truncate-end">
      {display}
    </Text>
  );
};
