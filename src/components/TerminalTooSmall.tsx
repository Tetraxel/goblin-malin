import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "#base/themeContext";
import { useShortcutLiteral } from "#hooks/useShortcutLiteral";
import { terminalTooSmallMessage } from "#utils/terminalSize";

/** Replaces the whole interface while the terminal is under the minimum size. The text wraps so it stays readable on a very narrow pane. */
export const TerminalTooSmall: React.FC<{ width: number; height: number }> = ({ width, height }) => {
    const theme = useTheme();
    const quitKey = useShortcutLiteral("global.quit");
    return (
        <Box
            width={width}
            height={height}
            overflow="hidden"
            flexDirection="column"
            backgroundColor={theme.ui.background}
        >
            <Text color={theme.status.warning} wrap="wrap">
                {terminalTooSmallMessage(width, height)}
            </Text>
            <Text color={theme.text.muted} wrap="wrap">
                Enlarge the window, or press {quitKey} to quit.
            </Text>
        </Box>
    );
};
