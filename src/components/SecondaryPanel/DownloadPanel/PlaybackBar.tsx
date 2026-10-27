import React, { useRef } from "react";
import { Box, Text, type DOMElement } from "ink";
import { getScreenBounds } from "#base/mouse/screenBounds";
import { useClickTarget } from "#base/mouse/useMouseTarget";
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
    /** Clicking the icon or the time toggles play/pause (so does clicking the track while nothing is loaded). */
    onToggle?: () => void;
    /** Clicking the track while it's loaded seeks to this fraction (0–1) of the file. */
    onSeek?: (fraction: number) => void;
}

// "▶  " / "⏸  " — the track starts right after it.
const ICON_WIDTH = 3;

export function PlaybackBar({
    positionMs,
    durationMs,
    width,
    isPlaying,
    isPaused,
    isFocused = false,
    onToggle,
    onSeek,
}: PlaybackBarProps) {
    const theme = useTheme();
    const barRef = useRef<DOMElement>(null);
    const active = isPlaying || isPaused;
    // Focused rows elsewhere get cellActive; keep the idle bar readable on top of it.
    const dim = !active && !isFocused;
    const effectiveWidth = Math.max(0, width - 2);
    const timeStr = "  " + (active ? formatDuration(positionMs) : "0:00") + " / " + formatDuration(durationMs);
    const barW = Math.max(6, effectiveWidth - ICON_WIDTH - timeStr.length);

    useClickTarget(barRef, (event) => {
        const left = getScreenBounds(barRef.current)?.x ?? 0;
        const cell = event.x - left - ICON_WIDTH;
        const isOnTrack = cell >= 0 && cell < barW;
        if (isOnTrack && active && onSeek) {
            // The last cell maps to the very end, the first to the start.
            onSeek(Math.min(1, cell / (barW - 1)));
        } else {
            onToggle?.();
        }
    });
    const ratio = active && durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;
    const filled = Math.floor(ratio * barW);
    const bar = "█".repeat(filled) + "░".repeat(barW - filled);

    return (
        <Box
            ref={barRef}
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
