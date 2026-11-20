import React from "react";
import { Text } from "ink";
import { type ColumnComponentProps } from "#components/TaskListPanel/TaskListPanel";
import { type MusicDownloadTaskAttributes } from "#flows/musicDownloadFlow/types";

/**
 * The task-list cell of a metadata service's column: the id of the track the service found (the last part of its
 * `uri`), green when there is one. Every service whose cell only shows that builds it here, with its registry key.
 */
export function createProviderIdCell(serviceKey: string) {
    const Cell = React.memo(function ProviderIdCell({
        task,
        isSelected,
    }: ColumnComponentProps<MusicDownloadTaskAttributes>) {
        const attrs = task.attributes;
        const group =
            attrs?.kind === "track" ? attrs.metadataGroups.find((g) => g.serviceKey === serviceKey) : undefined;
        const metadata = group?.results.find((r) => !r.isRejected)?.metadata;
        const id = metadata?.uri?.split("::").pop();

        return (
            <Text color={id ? "green" : "white"} underline={isSelected} wrap="truncate-end">
                {id || ""}
            </Text>
        );
    });
    Cell.displayName = `ProviderIdCell(${serviceKey})`;
    return Cell;
}
