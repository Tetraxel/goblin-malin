import React from "react";
import { Text } from "ink";
import { ColumnComponentProps } from "#components/TaskListPanel/TaskListPanel";
import { MusicDownloadTaskAttributes } from "#flows/musicDownloadFlow/types";

export const ToTagCell = React.memo(function ToTagCell({
    task,
    isSelected,
}: ColumnComponentProps<MusicDownloadTaskAttributes>) {
    const toTag = task.attributes?.toTag ?? false;
    const checkbox = toTag ? "☒" : "☐";

    return (
        <Text color={isSelected ? "green" : "white"} bold={toTag}>
            {checkbox}
        </Text>
    );
});
