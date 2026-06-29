import React from "react";
import { Box, Text } from "ink";
import { MetadataResultState } from "#flows/musicDownloadFlow/types";
import { useTheme } from "#base/themeContext";
import { Theme } from "#base/theme";
import { Uri } from "./Uri";
import { DiscoverySourceLine } from "./DiscoverySourceLine";

function formatDuration(ms: number | undefined): string {
    if (!ms) return "";
    const totalSec = Math.round(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `(${m}:${s.toString().padStart(2, "0")})`;
}

function confidenceBadge(result: MetadataResultState, theme: Theme): { text: string; color: string } {
    if (result.isPrimaryInput) return { text: "[USER]", color: theme.confidence.primary };
    const c = result.confidence;
    if (c === undefined) return { text: "[??%]", color: theme.text.secondary };
    const text = `[${c}%]`;
    if (c >= 90) return { text, color: theme.confidence.high };
    if (c >= 70) return { text, color: theme.confidence.medium };
    if (c >= 50) return { text, color: theme.confidence.low };
    return { text, color: theme.confidence.veryLow };
}

interface MetadataResultRowProps {
    result: MetadataResultState;
    serviceKey: string; // reserved for future per-provider styling
    isSelected: boolean;
    isActive: boolean;
    width: number;
    showDiscoverySources: boolean;
}

export const MetadataResultRow = React.memo(function MetadataResultRow({
    result,
    serviceKey: _serviceKey,
    isSelected,
    isActive,
    width,
    showDiscoverySources,
}: MetadataResultRowProps) {
    const theme = useTheme();
    const isDimmed = result.isRejected;
    const statusIcon = result.isRejected ? "✘" : result.isFavorited ? "★" : " ";
    const statusColor = result.isRejected
        ? theme.status.error
        : result.isFavorited
          ? theme.field.overridden
          : theme.text.secondary;

    const m = result.metadata;
    const artist = m.artists[0]?.name ?? "";
    const title = m.trackName ?? "";
    const info = artist ? `${title} - ${artist}` : title;
    const dur = formatDuration(m.duration);
    const suffix = info + (dur ? ` ${dur}` : "");

    const badge = confidenceBadge(result, theme);
    const badgeText = badge.text.padStart(6);
    const focusColorBg = isActive
        ? theme.ui.rowBackground.regular.cellActive
        : theme.ui.rowBackground.regular.highlighted;
    const bg = isSelected ? focusColorBg : undefined;

    const uri = m.uri ?? `${m.platform.toUpperCase()}::TRACK::${m.id}`;

    const sourceLines = showDiscoverySources && result.discoverySources.length > 0 ? result.discoverySources : [];

    return (
        <Box flexDirection="column" width={width} overflow="hidden" flexShrink={0}>
            {/* Main result row */}
            <Box
                flexDirection="row"
                width={width}
                minWidth={width}
                height={1}
                overflow="hidden"
                backgroundColor={bg}
                flexWrap="nowrap"
                alignItems="flex-start"
                flexShrink={0}
            >
                <Box width={3} minWidth={3} flexShrink={0} marginRight={2}>
                    <Text>{isSelected && isActive ? "☛ " : "  "}</Text>
                </Box>
                <Box width={2} minWidth={2} paddingRight={1} flexShrink={0}>
                    <Text dimColor={isDimmed} color={statusColor}>
                        {statusIcon}
                    </Text>
                </Box>
                <Box width={7} minWidth={7} paddingRight={1} flexShrink={0}>
                    <Text color={badge.color} dimColor={isDimmed} strikethrough={isDimmed}>
                        {badgeText}
                    </Text>
                </Box>
                <Box flexShrink={0}>
                    <Uri
                        uri={uri}
                        platform={m.platform}
                        fetchState={result.fetchState}
                        dimmed={isDimmed}
                        fetchedBy={m.fetchedBy}
                    />
                </Box>
                {result.fetchState === "error" && result.fetchError && (
                    <Box paddingLeft={1} flexShrink={0}>
                        <Text color={theme.status.error} wrap="truncate-end">
                            {result.fetchError}
                        </Text>
                    </Box>
                )}
                <Box flexGrow={1} overflow="hidden" paddingLeft={1}>
                    <Text color={theme.text.primary} dimColor={isDimmed} strikethrough={isDimmed} wrap="truncate-end">
                        {suffix}
                    </Text>
                </Box>
                {isSelected && (
                    <Box
                        flexDirection="row"
                        height={1}
                        width={5}
                        minWidth={5}
                        paddingLeft={1}
                        paddingRight={1}
                        flexShrink={0}
                    >
                        <Text color={theme.text.secondary} dimColor={isDimmed}>
                            {">>>"}
                        </Text>
                    </Box>
                )}
            </Box>
            {/* Discovery source lines */}
            {sourceLines.map((src, i) => (
                <DiscoverySourceLine key={i} source={src} dimmed={isDimmed} />
            ))}
        </Box>
    );
});
