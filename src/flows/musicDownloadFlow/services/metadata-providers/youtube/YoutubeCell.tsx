import React from "react";
import { Text } from "ink";
import { ColumnComponent } from "#components/TaskListPanel/TaskListPanel";
import { MusicDownloadTaskAttributes } from "#flows/musicDownloadFlow/types";

export const YoutubeCell: ColumnComponent<MusicDownloadTaskAttributes> = ({ task, isSelected }) => {
    const metadata = task.attributes?.metadataSources.find(
        (source) => source.metadata.apiProvider === "youtube"
    )?.metadata;
    const fullUri = metadata?.uri;
    const uri = fullUri?.split("::").pop();

    return (
        <Text color={uri ? "green" : "white"} underline={isSelected} wrap="truncate-end">
            {uri || ""}
        </Text>
    );
};
