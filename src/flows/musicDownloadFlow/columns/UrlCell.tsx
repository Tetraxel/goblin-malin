import React from "react";
import { Box, Text } from "ink";
import { ColumnComponentProps } from "#components/TaskListPanel/TaskListPanel";
import { MusicDownloadTaskAttributes } from "#flows/musicDownloadFlow/types";
import { Uri } from "#components/SecondaryPanel/MetadataPanel/Uri";
import { formatTrackUri } from "#flows/musicDownloadFlow/utils/trackUri";
import { providerDisplayRegistry } from "#base/providerDisplay";

export const UrlCell = React.memo(function UrlCell({
    task,
    isSelected,
}: ColumnComponentProps<MusicDownloadTaskAttributes>) {
    const attrs = task.attributes;

    if (attrs?.kind === "collection") {
        const display = providerDisplayRegistry.get(attrs.recognizedServiceKey ?? "unknown");
        const hasChildren = attrs.childTaskIds.length > 0;
        const kindLabel = attrs.collectionKind === "album" ? "ALBUM" : "PLAYLIST";
        const name = attrs.name ?? attrs.userInput.url;
        return (
            <Box flexDirection="row" flexShrink={0} gap={1}>
                {/* Fixed-width unit (never shrinks/clips mid-character) — only `name`
                    below is allowed to shrink, via its own wrap="truncate-end". A fixed
                    `width` (not a leading space in the string) keeps the label aligned
                    whether or not this row has an arrow to show. */}
                <Box flexShrink={0} gap={1}>
                    <Box width={1} flexShrink={0}>
                        {hasChildren && <Text color={display.color}>{attrs.collapsed ? "▸" : "▾"}</Text>}
                    </Box>
                    <Text color={display.color} bold>
                        [{kindLabel}]
                    </Text>
                </Box>
                <Text color={isSelected ? "green" : "white"} underline={isSelected} wrap="truncate-end">
                    {name}
                </Text>
            </Box>
        );
    }

    // Child track rows (spawned by a collection's expansion) get a small indent —
    // via marginLeft, not leading space characters (those don't reflow/clip
    // correctly once the column narrows below the string's own width).
    const isChildTrack = Boolean(attrs?.parentTaskId);
    // flexShrink={0} here is load-bearing: as a bare row sibling this Text has the
    // default flexShrink=1, so Yoga would shrink it to zero width (making it vanish
    // silently) whenever the row is too narrow for it + the Uri sibling — leaving
    // the marginLeft/gap spacing but no arrow. Wrapping it fixes its width instead.
    const indent = isChildTrack ? (
        <Box flexShrink={0}>
            <Text dimColor>↳</Text>
        </Box>
    ) : null;

    const primaryResult = attrs?.metadataGroups
        .flatMap((g) => g.results)
        .find((r) => r.isPrimaryInput && (r.metadata.url || r.metadata.uri));

    // Fetched primary metadata wins (enriched, real platform).
    if (primaryResult?.metadata.uri) {
        return (
            <Box flexDirection="row" flexShrink={0} gap={1} marginLeft={isChildTrack ? 1 : 0}>
                {indent}
                <Uri
                    uri={primaryResult.metadata.uri}
                    platform={primaryResult.metadata.platform}
                    fetchState={primaryResult.fetchState}
                    dimmed={!isSelected}
                    noPaddingX
                />
            </Box>
        );
    }

    // Otherwise show the URI recognized at import time, before any fetch.
    const importUri = attrs?.uri;
    if (importUri) {
        return (
            <Box flexDirection="row" flexShrink={0} gap={1} marginLeft={isChildTrack ? 1 : 0}>
                {indent}
                <Uri uri={formatTrackUri(importUri)} platform={importUri.platform} dimmed={!isSelected} noPaddingX />
            </Box>
        );
    }

    // Unrecognized URL: show the raw input
    return (
        <Box flexDirection="row" flexShrink={0} gap={1} marginLeft={isChildTrack ? 1 : 0}>
            {indent}
            <Text color={isSelected ? "green" : "white"} underline={isSelected} wrap="truncate-end">
                {attrs?.userInput?.url ?? "Unknown URL"}
            </Text>
        </Box>
    );
});
