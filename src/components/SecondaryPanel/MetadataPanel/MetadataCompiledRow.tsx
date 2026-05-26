import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "#base/themeContext";
import { CompiledMetadata } from "#flows/musicDownloadFlow/utils/compiledMetadata";
import { formatDuration } from "../utils";

const COMPILED_PREFIX = "🏆 Compiled Metadata: ";

interface CompiledRowProps {
    compiled: CompiledMetadata;
    overrideCount: number;
    isSelected: boolean;
    isActive: boolean;
    width: number;
}

export const MetadataCompiledRow: React.FC<CompiledRowProps> = ({
    compiled,
    overrideCount,
    isSelected,
    isActive,
    width,
}) => {
    const theme = useTheme();
    const focusColorBg = isActive ? theme.ui.rowActiveBackground : theme.ui.rowBackground;
    const bg = isSelected ? focusColorBg : undefined;
    const artist = compiled.artists[0]?.name ?? "";
    const title = compiled.trackName ?? "";
    const duration = compiled.duration ? formatDuration(compiled.duration) : "";
    const durationPart = duration ? ` (${duration})` : "";
    const trackInfo = artist ? `${artist} - ${title}${durationPart}` : `${title}${durationPart}`;
    const suffixText = overrideCount > 0 ? ` (${overrideCount} edit${overrideCount === 1 ? "" : "s"})` : "";

    return (
        <Box
            flexDirection="row"
            height={1}
            flexShrink={0}
            width={width}
            minWidth={width}
            overflow="hidden"
            backgroundColor={bg}
        >
            <Box width={3} minWidth={3}>
                <Text color={isSelected && isActive ? theme.text.active : theme.text.secondary}>
                    {isSelected && isActive ? "☛ " : "  "}
                </Text>
            </Box>
            <Box width={COMPILED_PREFIX.length} minWidth={COMPILED_PREFIX.length}>
                <Text color={theme.action.primary}>{COMPILED_PREFIX}</Text>
            </Box>
            <Box flexGrow={1} flexDirection="row">
                <Text color={theme.text.primary} wrap="truncate-end">
                    {trackInfo}
                </Text>
            </Box>
            {overrideCount > 0 && (
                <Box flexShrink={0}>
                    <Text color={theme.text.secondary} italic wrap="truncate-end">
                        {suffixText}
                    </Text>
                </Box>
            )}
            {isSelected && (
                <Box flexDirection="row" height={1} width={5} minWidth={5} paddingLeft={1} paddingRight={1}>
                    <Text color={theme.text.secondary}>{">>>"}</Text>
                </Box>
            )}
        </Box>
    );
};
