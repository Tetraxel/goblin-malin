import React from "react";
import { Box, Text } from "ink";
import { type DiscoverySource, type SearchKey } from "#flows/musicDownloadFlow/types";
import { providerDisplayRegistry } from "#base/providerDisplay";
import { useTheme } from "#base/themeContext";
import { Uri } from "./Uri";
import { wrapText } from "#utils/wrapText";
import { clipText, firstSentence } from "#utils/textSummary";

function formatSearchKeys(keys: SearchKey[]): string {
    return keys
        .map((k) => {
            switch (k) {
                case "url":
                    return "URL";
                case "isrc":
                    return "ISRC";
                case "trackName":
                    return "Title";
                case "artistName":
                    return "Artist Name";
                case "trackName+artistName":
                    return "Title, Artist Name";
                case "trackName+artistName+isrc":
                    return "Title, Artist Name, ISRC";
            }
        })
        .join(", ");
}

interface DiscoverySourceLineProps {
    source: DiscoverySource;
    dimmed?: boolean;
    /** Width of the row this line sits under: the explanation is wrapped to it. */
    width?: number;
}

/** Lines of "why" shown under a source: a one-line summary, two at most when the panel is narrow. */
const WHY_LINES = 2;
const WHY_LABEL = "why ";
const LINE_INDENT = 14;

export const DiscoverySourceLine: React.FC<DiscoverySourceLineProps> = ({ source, dimmed, width }) => {
    const theme = useTheme();
    const discovererDisplay = providerDisplayRegistry.get(source.discoveredBy);
    const fromUriPlatform = source.fromUri.split("::")[0]?.toLowerCase() ?? "";
    const keysLabel = formatSearchKeys(source.searchKeys);

    // Why the discoverer chose it: the short line it wrote for this spot (the full text is in the logs). A source
    // saved before summaries existed has only the full explanation: its first sentence stands in.
    const why = source.summary ?? (source.explanation ? clipText(firstSentence(source.explanation), 140) : "");
    const whyLines = why
        ? wrapText(why, Math.max(20, (width ?? 100) - LINE_INDENT - 3 - WHY_LABEL.length - 3), WHY_LINES)
        : [];

    // A link the user pasted was not "found" by anything.
    if (source.discoveredBy === "user") {
        return (
            <Box flexDirection="row" overflow="hidden" marginLeft={14} flexShrink={0} height={1}>
                <Text color={theme.text.secondary} dimColor={dimmed} wrap="truncate-end">
                    {"└─ added by you (pasted link)"}
                </Text>
            </Box>
        );
    }

    return (
        <Box flexDirection="column" flexShrink={0}>
            <Box flexDirection="row" overflow="hidden" marginLeft={LINE_INDENT} flexShrink={0} height={1}>
                <Box flexShrink={0}>
                    <Text color={theme.text.secondary} dimColor={dimmed} wrap="truncate-end">
                        {"└─ found by "}
                    </Text>
                </Box>
                <Box flexShrink={0}>
                    <Text color={discovererDisplay.color} dimColor={dimmed} wrap="truncate-end">
                        {discovererDisplay.label}
                    </Text>
                </Box>
                <Box flexShrink={0}>
                    <Text color={theme.text.secondary} dimColor={dimmed} wrap="truncate-end">
                        {" using "}
                    </Text>
                </Box>
                <Uri uri={source.fromUri} platform={fromUriPlatform} dimmed={dimmed} />
                <Box flexShrink={0}>
                    <Text color={theme.text.secondary} dimColor={dimmed} wrap="truncate-end">
                        {` (${keysLabel})`}
                    </Text>
                </Box>
            </Box>
            {whyLines.length > 0 && (
                <Box marginLeft={LINE_INDENT + 3} flexDirection="row" flexShrink={0}>
                    <Box flexShrink={0}>
                        <Text color={theme.text.muted} dimColor={dimmed}>
                            {WHY_LABEL}
                        </Text>
                    </Box>
                    <Box flexDirection="column" flexShrink={0}>
                        {whyLines.map((line, i) => (
                            <Text key={i} color={theme.text.secondary} dimColor={dimmed} wrap="truncate-end">
                                {line}
                            </Text>
                        ))}
                    </Box>
                </Box>
            )}
        </Box>
    );
};
