import React, { useSyncExternalStore } from "react";
import { Box, Text } from "ink";
import { AnimatedIcon, Icon } from "#components/AnimatedIcon";
import { useShortcuts } from "#hooks/useShortcuts";
import { useTheme } from "#base/themeContext";
import { shutdownState } from "#utils/shutdownState";

interface ClosingModalProps {
    terminalHeight: number;
}

const MODAL_WIDTH = 40;

/** Shown from the moment Exit is pressed until the process is gone, so a slow save doesn't look like a freeze. */
export const ClosingModal: React.FC<ClosingModalProps> = ({ terminalHeight }) => {
    const theme = useTheme();
    const state = useSyncExternalStore(shutdownState.subscribe, shutdownState.get);

    // Nothing else is meant to happen while closing: swallow every key.
    useShortcuts({ id: "closingModal", isActive: state !== null, exclusive: true, priority: 1000, shortcuts: [] });

    if (state === null) return null;

    const color = state.done ? theme.status.success : theme.action.destructive;

    return (
        <Box
            position="absolute"
            width="100%"
            height={terminalHeight}
            flexDirection="column"
            justifyContent="center"
            alignItems="center"
        >
            <Box
                flexDirection="column"
                borderStyle="round"
                borderColor={color}
                borderBackgroundColor={theme.ui.background}
                backgroundColor={theme.ui.background}
                paddingX={2}
                paddingY={1}
                width={MODAL_WIDTH}
                flexShrink={0}
            >
                <Box flexDirection="row" gap={1}>
                    <Box flexShrink={0}>
                        {state.done ? (
                            <Text color={color}>✓</Text>
                        ) : (
                            <AnimatedIcon icon={Icon.Dots} interval={80} color={color} />
                        )}
                    </Box>
                    <Text bold color={color}>
                        {state.done ? "Goblin Malin is closed" : "Goblin Malin is closing"}
                    </Text>
                </Box>
                <Box marginTop={1}>
                    <Text color={theme.text.secondary} wrap="truncate-end">
                        {state.step}
                    </Text>
                </Box>
            </Box>
        </Box>
    );
};
