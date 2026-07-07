import React from "react";
import { Text } from "ink";
import { ColumnComponentProps } from "#components/TaskListPanel/TaskListPanel";
import { MusicDownloadTaskAttributes } from "#flows/musicDownloadFlow/types";
import { computeCompiledMetadata } from "#flows/musicDownloadFlow/utils/compiledMetadata";

export const TrackCell = React.memo(function TrackCell({
    task,
    isSelected,
}: ColumnComponentProps<MusicDownloadTaskAttributes>) {
    const attrs = task.attributes;

    const trackName =
        attrs?.kind === "collection"
            ? attrs.totalCount !== undefined
                ? `${attrs.totalCount} track${attrs.totalCount === 1 ? "" : "s"}`
                : ""
            : computeCompiledMetadata(attrs?.metadataGroups ?? [], attrs?.metadataOverride ?? {}).trackName;

    return (
        <Text color={isSelected ? "green" : "white"} underline={isSelected} wrap="truncate-end">
            {trackName}
        </Text>
    );
});
