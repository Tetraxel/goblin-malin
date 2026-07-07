import React from "react";
import { Text } from "ink";
import { ColumnComponentProps } from "#components/TaskListPanel/TaskListPanel";
import { MusicDownloadTaskAttributes } from "#flows/musicDownloadFlow/types";
import { computeCompiledMetadata } from "#flows/musicDownloadFlow/utils/compiledMetadata";

export const ArtistCell = React.memo(function ArtistCell({
    task,
    isSelected,
}: ColumnComponentProps<MusicDownloadTaskAttributes>) {
    const attrs = task.attributes;

    const artist =
        attrs?.kind === "collection"
            ? (attrs.ownerName ?? "")
            : (computeCompiledMetadata(attrs?.metadataGroups ?? [], attrs?.metadataOverride ?? {}).artists[0]?.name ??
              "");

    return (
        <Text color={isSelected ? "green" : "white"} underline={isSelected} wrap="truncate-end">
            {artist}
        </Text>
    );
});
