import React from "react";
import { Box, Text } from "ink";
import { providerDisplayRegistry } from "#base/providerDisplay";
import { useTheme } from "#base/themeContext";
import { type DownloadProvider, type TrackDownloadSource } from "#flows/musicDownloadFlow/types";
import { Hint } from "#components/Hint";
import { PanelFrame } from "./PanelFrame";

interface ProviderSummaryProps {
    provider: DownloadProvider;
    /** Every row this provider produced for the track. */
    sources: TrackDownloadSource[];
    /** Whether re-running its search + download is possible right now. */
    canRetry: boolean;
    width: number;
    height: number;
}

/** What the detail pane shows while the cursor is on a provider's header: how its attempts went, and how to redo them. */
export function ProviderSummary({ provider, sources, canRetry, width, height }: ProviderSummaryProps) {
    const theme = useTheme();
    const display = providerDisplayRegistry.get(provider);

    const count = (predicate: (s: TrackDownloadSource) => boolean) => sources.filter(predicate).length;
    const stats: { label: string; value: number; color: string }[] = [
        { label: "downloaded", value: count((s) => s.state === "downloaded"), color: theme.status.success },
        { label: "failed", value: count((s) => s.state === "failed"), color: theme.status.error },
        { label: "not needed", value: count((s) => s.state === "skipped"), color: theme.status.skipped },
        {
            label: "in progress",
            value: count((s) => s.state === "pending" || s.state === "searching" || s.state === "downloading"),
            color: theme.status.downloading,
        },
    ].filter((stat) => stat.value > 0);

    const hasSaved = sources.some((s) => s.savedFile);

    return (
        <Box flexDirection="column" width={width} height={height} overflow="hidden">
            <PanelFrame title={display.label.toUpperCase()} color={display.color} width={width} grow>
                <Box flexDirection="column" paddingX={1} paddingTop={1}>
                    <Text color={theme.text.primary} wrap="truncate-end">
                        {`${sources.length} ${sources.length === 1 ? "attempt" : "attempts"}`}
                    </Text>
                    <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
                        {stats.map((stat) => (
                            <Box key={stat.label} flexShrink={0}>
                                <Text color={stat.color}>{`${stat.value} ${stat.label}`}</Text>
                            </Box>
                        ))}
                    </Box>
                    <Box marginTop={1} flexShrink={0}>
                        {canRetry ? (
                            <Hint shortcutId="downloadSourceTree.retryProvider" label="Search and download again" />
                        ) : (
                            <Text color={theme.text.hint} wrap="wrap">
                                {hasSaved
                                    ? "One of these files is saved, so this can't be searched again."
                                    : "Can't search again while another download is running."}
                            </Text>
                        )}
                    </Box>
                </Box>
            </PanelFrame>
        </Box>
    );
}
