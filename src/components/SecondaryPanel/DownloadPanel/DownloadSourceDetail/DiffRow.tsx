import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../../../../base/themeContext";

const LABEL_W = 11;

export function DiffRow({ label, left, right }: { label: string; left: string; right: string }) {
    const theme = useTheme();
    const changed = left !== right;
    return (
        <Box flexDirection="row" paddingX={1} height={1} overflow="hidden">
            <Box width={LABEL_W} minWidth={LABEL_W} flexShrink={0}>
                <Text color={theme.diff.changed} bold wrap="truncate-end">
                    {label.toUpperCase().padEnd(LABEL_W)}
                </Text>
            </Box>
            <Box flexGrow={1} overflow="hidden">
                <Text color={changed ? theme.diff.base : theme.text.primary} dimColor={!changed} wrap="truncate-end">
                    {left}
                </Text>
            </Box>
            <Box width={1} minWidth={1} flexShrink={0}>
                <Text color={theme.diff.base}>│</Text>
            </Box>
            <Box flexGrow={1} overflow="hidden" paddingLeft={1}>
                <Text color={changed ? theme.diff.modified : theme.text.primary} wrap="truncate-end">
                    {right}
                </Text>
            </Box>
            {changed && (
                <Box width={2} minWidth={2} flexShrink={0}>
                    <Text color={theme.diff.modified}> ←</Text>
                </Box>
            )}
        </Box>
    );
}
