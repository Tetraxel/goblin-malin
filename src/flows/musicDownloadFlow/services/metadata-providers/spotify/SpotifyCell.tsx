import React from "react";
import { Text } from "ink";
import { ColumnComponentProps } from "#components/TaskListPanel/TaskListPanel";
import { MusicDownloadTaskAttributes } from "#flows/musicDownloadFlow/types";

export const SpotifyCell = React.memo(function SpotifyCell({
    task,
    isSelected,
}: ColumnComponentProps<MusicDownloadTaskAttributes>) {
    const group = task.attributes?.metadataGroups.find((g) => g.serviceKey === "spotify");
    const metadata = group?.results.find((r) => !r.isRejected)?.metadata;
    const fullUri = metadata?.uri;
    const uri = fullUri?.split("::").pop();

    return (
        <Text color={uri ? "green" : "white"} underline={isSelected} wrap="truncate-end">
            {uri || ""}
        </Text>
    );
});
