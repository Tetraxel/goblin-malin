import React from "react";
import path from "path";
import { Text } from "ink";
import { type ColumnComponent } from "#components/TaskListPanel/TaskListPanel";
import { type MusicDownloadTaskAttributes } from "#flows/musicDownloadFlow/types";
import { localFileName } from "#flows/musicDownloadFlow/utils/localFileName";

export const YtDlpCell: ColumnComponent<MusicDownloadTaskAttributes> = ({ task, isSelected }) => {
    const attrs = task.attributes;
    const downloadSource =
        attrs?.kind === "track" ? attrs.downloadSources.find((d) => d.provider === "ytdlp") : undefined;
    // The saved file is the task's own; it is shown here when this provider is where it came from.
    const saved = attrs?.kind === "track" && attrs.savedFile?.provider === "ytdlp" ? attrs.savedFile : undefined;
    const display = saved
        ? path.basename(saved.path)
        : downloadSource?.localFile
          ? localFileName(downloadSource.localFile)
          : (downloadSource?.state ?? "");

    const color = saved ? "cyan" : downloadSource?.state === "downloaded" ? "green" : "white";

    return (
        <Text color={color} underline={isSelected} wrap="truncate-end">
            {display}
        </Text>
    );
};
