import React from "react";
import { Text } from "ink";
import { ColumnComponentProps } from "#components/TaskListPanel/TaskListPanel";
import { MusicDownloadTaskAttributes } from "#flows/musicDownloadFlow/types";
import { computeCompiledMetadata } from "#flows/musicDownloadFlow/utils/compiledMetadata";

export const TrackCell = React.memo(function TrackCell({
    task,
    isSelected,
}: ColumnComponentProps<MusicDownloadTaskAttributes>) {
    const groups = task.attributes?.metadataGroups ?? [];
    const overrides = task.attributes?.metadataOverride ?? {};
    const compiled = computeCompiledMetadata(groups, overrides);
    const trackName = compiled.trackName;

    return (
        <Text color={isSelected ? "green" : "white"} underline={isSelected} wrap="truncate-end">
            {trackName}
        </Text>
    );
});
