import React from "react";
import { Text } from "ink";
import { ColumnComponentProps } from "#components/TaskListPanel/TaskListPanel";
import { MusicDownloadTaskAttributes } from "#flows/musicDownloadFlow/types";

export const MusicBrainzCell = React.memo(function MusicBrainzCell({ task, isSelected }: ColumnComponentProps<MusicDownloadTaskAttributes>) {
    const attrs = task.attributes;
    const anchor = attrs?.discoveryAnchors?.["musicBrainz"];

    // Use stored count when available (O(1)); fall back to scanning discoverySources
    // for tasks run before the anchor field existed (e.g. loaded from an old session).
    const count =
        anchor?.count ??
        attrs?.metadataGroups.reduce(
            (sum, g) =>
                sum + g.results.filter((r) => r.discoverySources.some((s) => s.discoveredBy === "musicBrainz")).length,
            0
        ) ??
        0;

    const hasResult = count > 0 || anchor?.state === "found";
    const color = hasResult ? "#ba47b5" : "gray";

    return (
        <Text color={color} underline={isSelected} wrap="truncate-end">
            {hasResult ? `✓ ${count}` : "✗"}
        </Text>
    );
});
