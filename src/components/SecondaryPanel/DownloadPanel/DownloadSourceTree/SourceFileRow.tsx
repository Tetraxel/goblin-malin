import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "#base/themeContext";
import { TrackDownloadSource } from "#flows/musicDownloadFlow/types";
import { formatBytes } from "#components/SecondaryPanel/DownloadPanel/utils";
import { StateBadge } from "../StateBadge";

interface SourceFileRowProps {
    source: TrackDownloadSource;
    sourceIndex: number;
    isSelected: boolean;
    isActive: boolean;
    width: number;
}

export function SourceFileRow({ source, sourceIndex, isSelected, isActive, width }: SourceFileRowProps) {
    const theme = useTheme();
    const bg =
        isSelected && isActive
            ? theme.ui.rowBackground.regular.cellActive
            : isSelected
              ? theme.ui.rowBackground.regular.highlighted
              : undefined;

    const localFile = source.localFile;
    const filename = localFile ? `${localFile.name}.${localFile.extension}` : null;
    const sizeText = source.fileInfo ? formatBytes(source.fileInfo.sizeBytes) : "";

    // While the file isn't downloaded yet there's no filename — show the anticipated
    // track name (dimmed) so the row is recognizable during download. The state badge
    // on the right communicates progress, so we don't repeat it on the left.
    const artist = source.track.artists?.[0]?.name ?? "";
    const trackLabel = artist ? `${artist} - ${source.track.trackName}` : source.track.trackName;

    return (
        <Box
            flexDirection="row"
            width={width}
            minWidth={width}
            height={1}
            overflow="hidden"
            backgroundColor={bg}
            paddingLeft={1}
        >
            <Box width={3} minWidth={3} flexShrink={0}>
                <Text color={theme.ui.focusIndicator}>{isSelected && isActive ? "☛ " : "  "}</Text>
            </Box>
            <Box width={2} minWidth={2} flexShrink={0}>
                {source.isRejected ? (
                    <Text color={theme.status.error}>✘ </Text>
                ) : source.selected ? (
                    <Text color={theme.ui.selection}>✓ </Text>
                ) : (
                    <Text>{"  "}</Text>
                )}
            </Box>
            <Box minWidth={3} flexShrink={0}>
                <Text color={theme.text.secondary} dimColor={source.isRejected} strikethrough={source.isRejected}>
                    {`${sourceIndex + 1}. `}
                </Text>
            </Box>
            <Box flexGrow={1} overflow="hidden">
                {filename ? (
                    <Text
                        color={theme.text.primary}
                        wrap="truncate-end"
                        dimColor={source.isRejected}
                        strikethrough={source.isRejected}
                    >
                        {filename}
                    </Text>
                ) : (
                    <Text
                        color={source.state === "failed" ? theme.status.error : theme.text.secondary}
                        dimColor
                        wrap="truncate-end"
                    >
                        {trackLabel}
                    </Text>
                )}
            </Box>
            {sizeText !== "" && (
                <Box minWidth={sizeText.length + 1} paddingLeft={1} flexShrink={0}>
                    <Text color={theme.text.secondary}>{sizeText}</Text>
                </Box>
            )}
            <Box paddingLeft={1} paddingRight={1} flexShrink={0}>
                <StateBadge source={source} />
            </Box>
        </Box>
    );
}
