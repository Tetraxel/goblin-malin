import React from "react";
import { Text } from "ink";
import { ColumnComponent } from "#components/TaskListPanel/TaskListPanel";
import { MusicDownloadTaskAttributes } from "#flows/musicDownloadFlow/types";

export const UrlCell: ColumnComponent<MusicDownloadTaskAttributes> = ({ task, isSelected }) => {
    const primaryResult = task.attributes?.metadataGroups
        .flatMap((g) => g.results)
        .find((r) => r.isPrimaryInput && (r.metadata.url || r.metadata.uri));
    const url = primaryResult?.metadata.uri ?? primaryResult?.metadata.url ?? task.initialInput ?? "";

    return (
        <Text color={isSelected ? "green" : "white"} underline={isSelected} wrap="truncate-end">
            {url}
        </Text>
    );
};
