import React from "react";
import { Text } from "ink";
import { ColumnComponent } from "#components/TaskListPanel/TaskListPanel";
import { MusicDownloadTaskAttributes } from "#flows/musicDownloadFlow/types";
import { computeCompiledMetadata } from "#flows/musicDownloadFlow/utils/compiledMetadata";

export const ArtistCell: ColumnComponent<MusicDownloadTaskAttributes> = ({ task, isSelected }) => {
    const sources = task.attributes?.metadataSources ?? [];
    const overrides = task.attributes?.metadataOverride ?? {};
    const compiled = computeCompiledMetadata(sources, overrides);
    const artist = compiled.artists[0]?.name ?? "";

    return (
        <Text color={isSelected ? "green" : "white"} underline={isSelected} wrap="truncate-end">
            {artist}
        </Text>
    );
};
