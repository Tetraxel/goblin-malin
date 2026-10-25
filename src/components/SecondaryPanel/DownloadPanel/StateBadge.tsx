import React from "react";
import { Text } from "ink";
import { useTheme } from "#base/themeContext";
import { TrackDownloadSource } from "#flows/musicDownloadFlow/types";

export function StateBadge({ source }: { source: TrackDownloadSource }) {
    const theme = useTheme();
    const strikethrough = source.isRejected;
    if (source.savedFile) {
        return (
            <Text color={theme.status.locked} strikethrough={strikethrough}>
                ● SAVED
            </Text>
        );
    }
    switch (source.state) {
        case "downloading":
            return (
                <Text color={theme.status.downloading} strikethrough={strikethrough}>
                    {source.progress != null && source.progress > 0
                        ? `DOWNLOADING ${Math.round(source.progress)}%`
                        : "DOWNLOADING"}
                </Text>
            );
        case "downloaded":
            return (
                <Text color={theme.status.success} strikethrough={strikethrough}>
                    DOWNLOADED
                </Text>
            );
        case "failed":
            return (
                <Text color={theme.status.error} strikethrough={strikethrough}>
                    FAILED
                </Text>
            );
        case "searching":
            return (
                <Text color={theme.status.downloading} strikethrough={strikethrough}>
                    SEARCHING
                </Text>
            );
        case "skipped":
            return (
                <Text color={theme.status.skipped} strikethrough={strikethrough}>
                    NOT NEEDED
                </Text>
            );
        default:
            return (
                <Text color={theme.status.pending} strikethrough={strikethrough}>
                    PENDING
                </Text>
            );
    }
}
