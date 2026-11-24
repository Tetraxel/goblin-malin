import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "#base/themeContext";

const BAR_WIDTH = 24;

/**
 * One line: a bar and its percentage (when the step has a known fraction), then what is going on. The bar has a fixed
 * width and does not shrink; only the text is cut on a narrow panel.
 */
export function ProgressLine({ title, text, fraction }: { title?: string; text: string; fraction?: number }) {
    const theme = useTheme();
    const ratio = fraction === undefined ? undefined : Math.max(0, Math.min(1, fraction));
    const filled = ratio === undefined ? 0 : Math.round(ratio * BAR_WIDTH);
    return (
        <Box flexDirection="row" height={1} flexShrink={0} overflow="hidden">
            {title ? (
                <Box flexShrink={0} marginRight={1}>
                    <Text color={theme.status.processing} bold>
                        {title}
                    </Text>
                </Box>
            ) : null}
            {ratio !== undefined ? (
                <Box flexShrink={0} marginRight={1}>
                    <Text color={theme.ui.progressFill}>{"█".repeat(filled)}</Text>
                    <Text color={theme.ui.progressEmpty}>{"░".repeat(BAR_WIDTH - filled)}</Text>
                    <Text color={theme.text.secondary}>{` ${String(Math.round(ratio * 100)).padStart(3)} %`}</Text>
                </Box>
            ) : null}
            <Text color={theme.text.secondary} wrap="truncate-end">
                {text}
            </Text>
        </Box>
    );
}
