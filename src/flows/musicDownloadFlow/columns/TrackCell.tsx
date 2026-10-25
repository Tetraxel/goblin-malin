import React from "react";
import { Box, Text } from "ink";
import { ColumnComponentProps } from "#components/TaskListPanel/TaskListPanel";
import { AnimatedIcon, Icon } from "#components/AnimatedIcon";
import { useTheme } from "#base/themeContext";
import { MusicDownloadTaskAttributes } from "#flows/musicDownloadFlow/types";
import { computeCompiledMetadata } from "#flows/musicDownloadFlow/utils/compiledMetadata";

export const TrackCell = React.memo(function TrackCell({
    task,
    isSelected,
    playback,
}: ColumnComponentProps<MusicDownloadTaskAttributes>) {
    const theme = useTheme();
    const attrs = task.attributes;

    const trackName =
        attrs?.kind === "collection"
            ? attrs.totalCount !== undefined
                ? `${attrs.totalCount} track${attrs.totalCount === 1 ? "" : "s"}`
                : ""
            : computeCompiledMetadata(attrs?.metadataGroups ?? [], attrs?.metadataOverride ?? {}).trackName;

    return (
        <Box flexDirection="row" gap={1}>
            {playback && (
                <Box flexShrink={0}>
                    {playback === "playing" ? (
                        <AnimatedIcon icon={Icon.Equalizer} interval={250} color={theme.ui.progressFill} />
                    ) : (
                        // Flat bars = the same glyph, frozen low: reads as "paused" without an ambiguous-width ⏸.
                        <Text color={theme.text.secondary}>▂▂▂</Text>
                    )}
                </Box>
            )}
            <Text color={isSelected ? "green" : "white"} underline={isSelected} wrap="truncate-end">
                {trackName}
            </Text>
        </Box>
    );
});
