import React from "react";
import { Text } from "ink";
import { ColumnComponentProps } from "#components/TaskListPanel/TaskListPanel";
import { MusicDownloadTaskAttributes } from "#flows/musicDownloadFlow/types";
import { Uri } from "#components/SecondaryPanel/MetadataPanel/Uri";
import { formatTrackUri } from "#flows/musicDownloadFlow/utils/trackUri";

export const UrlCell = React.memo(function UrlCell({ task, isSelected }: ColumnComponentProps<MusicDownloadTaskAttributes>) {
    const primaryResult = task.attributes?.metadataGroups
        .flatMap((g) => g.results)
        .find((r) => r.isPrimaryInput && (r.metadata.url || r.metadata.uri));

    // Fetched primary metadata wins (enriched, real platform).
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

    // Otherwise show the URI recognized at import time, before any fetch.
    const importUri = task.attributes?.uri;
    if (importUri) {
        return <Uri uri={formatTrackUri(importUri)} platform={importUri.platform} dimmed={!isSelected} noPaddingX />;
    }

    // Unrecognized URL: show the raw input
    return (
        <Text color={isSelected ? "green" : "white"} underline={isSelected} wrap="truncate-end">
            {task.attributes?.userInput?.url ?? "Unknown URL"}
        </Text>
    );
});
