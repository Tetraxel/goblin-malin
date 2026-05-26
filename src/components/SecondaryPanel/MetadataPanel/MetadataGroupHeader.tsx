import React from "react";
import { Box, Text } from "ink";
import { MetadataGroupState } from "#flows/musicDownloadFlow/types";
import { providerDisplayRegistry } from "#base/providerDisplay";
import { useTheme } from "#base/themeContext";

interface MetadataGroupHeaderProps {
    group: MetadataGroupState;
    isSelected: boolean;
    isActive: boolean;
}

export const MetadataGroupHeader: React.FC<MetadataGroupHeaderProps> = ({ group, isSelected, isActive }) => {
    const theme = useTheme();
    const display = providerDisplayRegistry.get(group.serviceKey);
    const focusColorBg = isActive ? theme.ui.rowActiveBackground : theme.ui.rowBackground;
    const bg = isSelected ? focusColorBg : undefined;

    const primaryResult = group.results.find((r) => r.isPrimaryInput);
    const isFallback =
        primaryResult?.metadata.fetchedBy && primaryResult.metadata.fetchedBy !== primaryResult.metadata.apiProvider;
    const fetchedByLabel = isFallback
        ? providerDisplayRegistry.get(primaryResult!.metadata.fetchedBy!).label
        : undefined;

    const countLabel = `(${group.results.length} result${group.results.length !== 1 ? "s" : ""})`;
    const noteText = isFallback
        ? `ℹ ${display.label} is not available but rudimentary metadata were fetched from ${fetchedByLabel}`
        : undefined;

    return (
        <Box
            flexDirection="row"
            flexGrow={1}
            flexShrink={0}
            height={1}
            overflow="hidden"
            backgroundColor={bg}
            alignItems="flex-start"
        >
            <Box width={3} minWidth={3} flexShrink={0}>
                <Text color={isSelected && isActive ? theme.text.active : theme.text.secondary} wrap="truncate-end">
                    {isSelected && isActive ? "☛ " : "  "}
                </Text>
            </Box>
            <Box flexShrink={0}>
                <Text color={display.color} wrap="truncate-end" bold>
                    {"● " + display.label}
                </Text>
            </Box>
            <Box flexShrink={0}>
                <Text color={theme.text.secondary} wrap="truncate-end">
                    {" " + countLabel}
                </Text>
            </Box>
            {noteText && (
                <Box flexGrow={1} paddingLeft={3} flexShrink={0}>
                    <Text color={theme.palette.blue} italic wrap="truncate-end">
                        {noteText}
                    </Text>
                </Box>
            )}
        </Box>
    );
};
