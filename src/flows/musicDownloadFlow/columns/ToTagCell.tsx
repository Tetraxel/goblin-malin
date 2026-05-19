import React from "react";
import { Text } from "ink";
import { ColumnComponent } from "#components/TaskListPanel/TaskListPanel";
import { MusicDownloadTaskAttributes } from "#flows/musicDownloadFlow/types";

export const ToTagCell: ColumnComponent<MusicDownloadTaskAttributes> = ({ task, isSelected }) => {
    const toTag = task.attributes?.toTag ?? false;
    const checkbox = toTag ? "☒" : "☐";

    return (
        <Text color={isSelected ? "green" : "white"} bold={toTag}>
            {checkbox}
        </Text>
    );
};
