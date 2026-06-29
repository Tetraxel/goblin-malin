import React from "react";
import { Text } from "ink";
import { ColumnComponentProps } from "#components/TaskListPanel/TaskListPanel";
import { MusicDownloadTaskAttributes } from "#flows/musicDownloadFlow/types";

export const ToDownloadCell = React.memo(function ToDownloadCell({ task, isSelected }: ColumnComponentProps<MusicDownloadTaskAttributes>) {
    const toDownload = task.attributes?.toDownload ?? false;
    const checkbox = toDownload ? "☒" : "☐";

    return (
        <Text color={isSelected ? "green" : "white"} bold={toDownload}>
            {checkbox}
        </Text>
    );
});
