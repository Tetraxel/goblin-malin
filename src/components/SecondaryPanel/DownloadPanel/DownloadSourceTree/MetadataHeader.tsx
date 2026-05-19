import React from "react";
import { Box, Text } from "ink";
import { providerDisplayRegistry } from "#base/providerDisplay";
import { useTheme } from "#base/themeContext";
import { TrackDownloadSource } from "#flows/musicDownloadFlow/types";

function getPlatformDisplay(apiProvider: string): {
    label: string;
    color: string;
} {
    const display = providerDisplayRegistry.get(apiProvider);
    return { label: display.label, color: display.color };
}

interface MetadataHeaderProps {
    source: TrackDownloadSource;
}

export function MetadataHeader({ source }: MetadataHeaderProps) {
    const theme = useTheme();
    const m = source.track;
    const { label: platformLabel, color: platformColor } = getPlatformDisplay(m.apiProvider);
    const type = m.type ? m.type.charAt(0).toUpperCase() + m.type.slice(1) : "Track";
    const artist = m.artists?.[0]?.name ?? "";
    const title = m.trackName ?? "";
    const info = artist ? `${artist} - ${title}` : title;
    const parts = [platformLabel, type, m.id].filter(Boolean);

    return (
        <Box paddingLeft={2} flexDirection="row" overflow="hidden" flexShrink={0}>
            <Box paddingRight={1} flexDirection="row" flexShrink={0}>
                <Text color={theme.text.secondary}>{"└─ used"}</Text>
            </Box>
            {parts.map((part, idx) => (
                <Box key={idx} flexDirection="row" flexShrink={0}>
                    {idx > 0 && <Text color={theme.text.secondary}>{" > "}</Text>}
                    <Text color={platformColor} wrap="truncate-end">
                        {part}
                    </Text>
                </Box>
            ))}
            <Text color={theme.text.primary} wrap="truncate-end">{` (${info})`}</Text>
        </Box>
    );
}
