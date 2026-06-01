import React from "react";
import { Text } from "ink";
import { ColumnComponent } from "#components/TaskListPanel/TaskListPanel";
import { MusicDownloadTaskAttributes } from "#flows/musicDownloadFlow/types";
import { Uri } from "#components/SecondaryPanel/MetadataPanel/Uri";

export const UrlCell: ColumnComponent<MusicDownloadTaskAttributes> = ({ task, isSelected }) => {
    const primaryResult = task.attributes?.metadataGroups
        .flatMap((g) => g.results)
        .find((r) => r.isPrimaryInput && (r.metadata.url || r.metadata.uri));

    if (primaryResult?.metadata.uri) {
        return (
            <Uri
                uri={primaryResult.metadata.uri}
                platform={primaryResult.metadata.platform}
                fetchState={primaryResult.fetchState}
                dimmed={!isSelected}
                noPaddingX
            />
        );
    }

    const url = primaryResult?.metadata.url ?? task.attributes?.userInput.url ?? "";
    return (
        <Text color={isSelected ? "green" : "white"} underline={isSelected} wrap="truncate-end">
            {url}
        </Text>
    );
};
