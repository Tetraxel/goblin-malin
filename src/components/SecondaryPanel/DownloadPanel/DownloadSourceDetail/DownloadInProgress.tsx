import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "#base/themeContext";
import { TrackDownloadSource } from "#flows/musicDownloadFlow/types";

interface DownloadInProgressProps {
    source: TrackDownloadSource;
    width: number;
    height: number;
}

/**
 * Shown in place of the "NEW FILE" preview while a source has no file on disk yet
 * (still downloading, queued/searching, or failed). There's nothing to preview or
 * save, so we surface the current state instead.
 */
export function DownloadInProgress({ source, width, height }: DownloadInProgressProps) {
    const theme = useTheme();

    const isFailed = source.state === "failed";
    const stateLabel = isFailed ? "FAILED" : source.state === "searching" ? "SEARCHING" : "DOWNLOADING";
    const stateColor = isFailed ? theme.status.error : theme.status.downloading;

    const innerWidth = width - 2;
    const headerDashes = Math.max(0, innerWidth - stateLabel.length - 2);
    const headerLeftD = Math.floor(headerDashes / 2);
    const headerRightD = headerDashes - headerLeftD + 1;

    const artist = source.track.artists?.[0]?.name ?? "";
    const trackLabel = artist ? `${artist} - ${source.track.trackName}` : source.track.trackName;
    const progressText = source.progress != null && source.progress > 0 ? ` ${Math.round(source.progress)}%` : "";
    const message = isFailed
        ? "✘ Download failed"
        : source.state === "searching"
          ? "Searching for a source…"
          : `↓ Downloading…${progressText}`;

    return (
        <Box flexDirection="column" width={width} height={height} overflow="hidden">
            <Box flexDirection="row" height={1} flexShrink={0} overflow="hidden">
                <Text color={stateColor}>{`┌${"─".repeat(headerLeftD)} `}</Text>
                <Text color={stateColor}>{stateLabel}</Text>
                <Text color={stateColor}>{` ${"─".repeat(headerRightD)}┐`}</Text>
            </Box>
            <Box
                flexDirection="column"
                flexGrow={1}
                overflow="hidden"
                borderStyle="single"
                borderColor={stateColor}
                borderBackgroundColor={theme.ui.background}
                borderTop={false}
                paddingX={1}
                paddingTop={1}
            >
                <Text color={theme.text.primary} wrap="truncate-end">
                    {trackLabel}
                </Text>
                <Box marginTop={1}>
                    <Text color={stateColor}>{message}</Text>
                </Box>
            </Box>
        </Box>
    );
}
