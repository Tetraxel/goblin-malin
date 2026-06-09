import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "#base/themeContext";
import { TrackDownloadSource } from "#flows/musicDownloadFlow/types";
import { Uri } from "../../MetadataPanel/Uri";

interface MetadataHeaderProps {
    source: TrackDownloadSource;
}

export function MetadataHeader({ source }: MetadataHeaderProps) {
    const theme = useTheme();
    const m = source.track;
    const artist = m.artists?.[0]?.name ?? "";
    const title = m.trackName ?? "";
    const info = artist ? `${artist} - ${title}` : title;
    const uri = m.uri ?? `${m.platform.toUpperCase()}::TRACK::${m.id}`;

    return (
        <Box marginLeft={2} flexDirection="row" overflow="hidden" flexShrink={0}>
            <Box paddingRight={1} flexDirection="row" flexShrink={0}>
                <Text color={theme.text.secondary}>{"└─ used"}</Text>
            </Box>
            <Box flexShrink={0}>
                <Uri uri={uri} platform={m.platform} />
            </Box>
            <Text color={theme.text.primary} wrap="truncate-end">{` (${info})`}</Text>
        </Box>
    );
}
