import React from "react";
import { Box, Text } from "ink";
import { DiscoverySource, SearchKey } from "#flows/musicDownloadFlow/types";
import { providerDisplayRegistry } from "#base/providerDisplay";
import { useTheme } from "#base/themeContext";
import { Uri } from "./Uri";

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
}

export const DiscoverySourceLine: React.FC<DiscoverySourceLineProps> = ({ source, dimmed }) => {
    const theme = useTheme();
    const discovererDisplay = providerDisplayRegistry.get(source.discoveredBy);
    const fromUriPlatform = source.fromUri.split("::")[0]?.toLowerCase() ?? "";
    const keysLabel = formatSearchKeys(source.searchKeys);

    return (
        <Box flexDirection="row" overflow="hidden" marginLeft={14} flexShrink={0} height={1}>
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
    );
};
