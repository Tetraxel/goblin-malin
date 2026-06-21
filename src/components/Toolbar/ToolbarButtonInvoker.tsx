import { Box, Text } from "ink";
import React, { useLayoutEffect } from "react";
import { ToolbarButtonHook } from "./Toolbar";
import { FlowBase } from "#base/flow/flow-base";
import { FlowOrchestrator } from "#base/flow/flow-orchestrator";
import { useToolbarActionsRef } from "#contexts/ToolbarActionsContext";
import { useTheme } from "#base/themeContext";
import { AnimatedIcon, Icon } from "#components/AnimatedIcon";

export const ToolbarButtonInvoker = ({
    hook,
    isSelected,
    index,
    flow,
    orchestrator,
}: {
    hook: ToolbarButtonHook;
    isSelected: boolean;
    index: number;
    flow: FlowBase;
    orchestrator: FlowOrchestrator;
}) => {
    const theme = useTheme();
    const actionsRef = useToolbarActionsRef();
    const { enabled, label, icon, inProgress, color, bold, italic, onPress } = hook({
        isSelected,
        flow,
        orchestrator,
    });

    // Register the current onPress for this button index into the shared ref.
    // Runs on every render so the handler always sees the latest closure.
    useLayoutEffect(() => {
        actionsRef.current[index] = onPress;
    });

    if (!enabled) return null;

    const textColor = isSelected ? theme.ui.background : (color as string | undefined);

    return (
        <Box
            key={index}
            paddingX={1}
            backgroundColor={isSelected ? color : undefined}
            overflow="hidden"
            flexShrink={0}
            gap={1}
        >
            {inProgress ? (
                <AnimatedIcon icon={Icon.Dots} interval={80} color={textColor} />
            ) : (
                <Text color={textColor} bold={bold} italic={italic}>
                    {icon}
                </Text>
            )}
            <Text color={textColor} bold={bold} italic={italic} wrap="truncate-end">
                {label}
            </Text>
        </Box>
    );
};
