import React from "react";
import { Box, Text } from "ink";
import { AnimatedIcon, Icon } from "#components/AnimatedIcon";
import { useTheme } from "#base/themeContext";

/** Marks the row whose file the player is on: moving bars while playing, flat bars while paused. */
export function PlaybackIndicator({ state }: { state: "playing" | "paused" }) {
    const theme = useTheme();
    return (
        <Box flexShrink={0}>
            {state === "playing" ? (
                <AnimatedIcon icon={Icon.Equalizer} interval={250} color={theme.ui.progressFill} />
            ) : (
                // Flat bars = the same glyph, frozen low: reads as "paused" without an ambiguous-width ⏸.
                <Text color={theme.text.secondary}>▂▂▂</Text>
            )}
        </Box>
    );
}
