import React from "react";
import { Text } from "ink";
import { ColumnComponentProps } from "#components/TaskListPanel/TaskListPanel";
import { MusicDownloadTaskAttributes } from "#flows/musicDownloadFlow/types";
import { computeCompiledMetadata } from "#flows/musicDownloadFlow/utils/compiledMetadata";

export const ArtistCell = React.memo(function ArtistCell({ task, isSelected }: ColumnComponentProps<MusicDownloadTaskAttributes>) {
    const groups = task.attributes?.metadataGroups ?? [];
    const overrides = task.attributes?.metadataOverride ?? {};
    const compiled = computeCompiledMetadata(groups, overrides);
    const artist = compiled.artists[0]?.name ?? "";

    return (
        <Text color={isSelected ? "green" : "white"} underline={isSelected} wrap="truncate-end">
            {artist}
        </Text>
    );
});
