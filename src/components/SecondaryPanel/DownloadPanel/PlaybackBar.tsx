import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "#base/themeContext";
import { formatDuration } from "../utils";

interface PlaybackBarProps {
    positionMs: number;
    durationMs: number;
    width: number;
    isPlaying: boolean;
    isPaused: boolean;
    /** The detail panel has keyboard focus, so this row is what Space/Shift+←/→ act on. */
    isFocused?: boolean;
}

export function PlaybackBar({
    positionMs,
    durationMs,
    width,
    isPlaying,
    isPaused,
    isFocused = false,
}: PlaybackBarProps) {
    const theme = useTheme();
    const active = isPlaying || isPaused;
    // Focused rows elsewhere get cellActive; keep the idle bar readable on top of it.
    const dim = !active && !isFocused;
    const effectiveWidth = Math.max(0, width - 2);
    const timeStr = "  " + (active ? formatDuration(positionMs) : "0:00") + " / " + formatDuration(durationMs);
    const barW = Math.max(6, effectiveWidth - 3 - timeStr.length);
    const ratio = active && durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;
    const filled = Math.floor(ratio * barW);
    const bar = "█".repeat(filled) + "░".repeat(barW - filled);

    return (
        <Box
            flexDirection="column"
            minHeight={1}
            height={1}
            flexShrink={0}
            overflow="hidden"
            marginBottom={1}
            marginX={1}
            backgroundColor={isFocused ? theme.ui.rowBackground.regular.cellActive : theme.ui.background}
        >
            <Box flexDirection="row" flexGrow={1} overflow="hidden">
                <Text color={isPlaying ? theme.ui.progressFill : theme.text.secondary} dimColor={dim}>
                    {isPaused ? "⏸  " : "▶  "}
                </Text>
                <Text color={isPlaying ? theme.ui.progressFill : theme.text.secondary} dimColor={dim}>
                    {bar}
                </Text>
                <Text color={theme.text.secondary} dimColor={dim}>
                    {timeStr}
                </Text>
            </Box>
        </Box>
    );
}
