import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { useTheme } from "#base/themeContext";
import { TrackDownloadSource } from "#flows/musicDownloadFlow/types";
import { formatDuration } from "../../utils";
import { formatBytes } from "../utils";

interface DownloadInProgressProps {
    source: TrackDownloadSource;
    width: number;
    height: number;
}

// Rows the block below the message needs besides the log: track label + gap, message + gap,
// bar, two stat lines, separator.
const FIXED_ROWS = 9;

/** Re-renders every second while `active`, so elapsed time keeps moving between progress updates. */
function useNow(active: boolean): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!active) return;
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, [active]);
    return now;
}

/**
 * Shown in place of the "NEW FILE" preview while a source has no file on disk yet
 * (still downloading, queued/searching, or failed). There's nothing to preview or
 * save, so we surface the current state instead.
 */
export function DownloadInProgress({ source, width, height }: DownloadInProgressProps) {
    const theme = useTheme();
    const isDownloading = source.state === "downloading";
    const now = useNow(isDownloading);
    const info = source.progressInfo;

    const { stateLabel, stateColor, message } = ((): { stateLabel: string; stateColor: string; message: string } => {
        switch (source.state) {
            case "failed":
                return { stateLabel: "FAILED", stateColor: theme.status.error, message: "✘ Download failed" };
            case "searching":
                return {
                    stateLabel: "SEARCHING",
                    stateColor: theme.status.downloading,
                    message: "Searching for a source…",
                };
            case "skipped":
                return {
                    stateLabel: "NOT NEEDED",
                    stateColor: theme.status.skipped,
                    message: "A better-ranked source already downloaded successfully — this one was never attempted.",
                };
            case "pending":
                return { stateLabel: "PENDING", stateColor: theme.status.pending, message: "Queued…" };
            default:
                return {
                    stateLabel: "DOWNLOADING",
                    stateColor: theme.status.downloading,
                    message: "↓ Downloading…",
                };
        }
    })();

    const innerWidth = width - 2;
    const headerDashes = Math.max(0, innerWidth - stateLabel.length - 2);
    const headerLeftD = Math.floor(headerDashes / 2);
    const headerRightD = headerDashes - headerLeftD + 1;

    const artist = source.track.artists?.[0]?.name ?? "";
    const trackLabel = artist ? `${artist} - ${source.track.trackName}` : source.track.trackName;

    // Progress block (only meaningful while downloading).
    const percent = Math.max(0, Math.min(100, Math.round(source.progress ?? 0)));
    const barWidth = Math.max(6, innerWidth - 2 - 5); // border + padding, then " 100%"
    const filled = Math.floor((percent / 100) * barWidth);
    const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);
    const sizeParts = [
        info?.downloadedBytes !== undefined
            ? info.totalBytes
                ? `${formatBytes(info.downloadedBytes)} / ${formatBytes(info.totalBytes)}`
                : formatBytes(info.downloadedBytes)
            : undefined,
        info?.speedBytesPerSec ? `${formatBytes(info.speedBytesPerSec)}/s` : undefined,
    ].filter(Boolean);
    const sizeLine = sizeParts.length > 0 ? sizeParts.join("  ·  ") : "Waiting for data…";
    const elapsedMs = info ? Math.max(0, now - info.startedAt) : undefined;
    const timeLine = [
        elapsedMs !== undefined
            ? `Elapsed ${formatDuration(elapsedMs) === "—" ? "0:00" : formatDuration(elapsedMs)}`
            : undefined,
        info?.etaSeconds !== undefined ? `ETA ${formatDuration(Math.max(1000, info.etaSeconds * 1000))}` : undefined,
    ]
        .filter(Boolean)
        .join("  ·  ");

    // The service's own output under the bar: whatever fits, newest last.
    const logRows = Math.max(0, height - 3 - (isDownloading ? FIXED_ROWS : 3));
    const logLines = (info?.log ?? []).slice(-logRows);

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
                {isDownloading && (
                    <>
                        <Box flexShrink={0}>
                            <Text color={theme.ui.progressFill}>{bar}</Text>
                            <Text color={theme.text.secondary}>{` ${percent}%`}</Text>
                        </Box>
                        <Text color={theme.text.secondary} wrap="truncate-end">
                            {sizeLine}
                        </Text>
                        <Text color={theme.text.secondary} wrap="truncate-end">
                            {timeLine}
                        </Text>
                    </>
                )}
                {logLines.length > 0 && (
                    <Box flexDirection="column" marginTop={isDownloading ? 1 : 0} flexShrink={0}>
                        {logLines.map((line, i) => (
                            <Text key={i} color={theme.text.hint} wrap="truncate-end">
                                {line}
                            </Text>
                        ))}
                    </Box>
                )}
            </Box>
        </Box>
    );
}
