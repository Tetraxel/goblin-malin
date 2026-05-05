import React from "react";
import { Box, Text } from "ink";
import { formatDuration } from "./utils";

interface PlaybackBarProps {
  positionMs: number;
  durationMs: number;
  width: number;
  isPlaying: boolean;
  isPaused: boolean;
}

export function PlaybackBar({
  positionMs,
  durationMs,
  width,
  isPlaying,
  isPaused,
}: PlaybackBarProps) {
  const active = isPlaying || isPaused;
  const effectiveWidth = Math.max(0, width - 2); // reserve marginX=1 on both sides
  const timeStr =
    "  " +
    (active ? formatDuration(positionMs) : "0:00") +
    " / " +
    formatDuration(durationMs);
  const barW = Math.max(6, effectiveWidth - 3 - timeStr.length);
  const ratio =
    active && durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;
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
      backgroundColor={"#131313"}
    >
      <Box flexDirection="row" flexGrow={1} overflow="hidden">
        <Text color={isPlaying ? "green" : "gray"} dimColor={!active}>
          {isPaused ? "⏸  " : "▶  "}
        </Text>
        <Text color={isPlaying ? "green" : "gray"} dimColor={!active}>
          {bar}
        </Text>
        <Text color="gray" dimColor={!active}>
          {timeStr}
        </Text>
      </Box>
    </Box>
  );
}
