import { Box, Text } from "ink";
import React, { useLayoutEffect } from "react";
import { ToolbarButtonHook } from "./Toolbar";
import { FlowBase } from "#base/flow/flow-base";
import { FlowOrchestrator } from "#base/flow/flow-orchestrator";
import { useToolbarActionsRef } from "#contexts/ToolbarActionsContext";
import { useTheme } from "#base/themeContext";

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
    const { enabled, label, icon, color, bold, italic, onPress } = hook({
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
    return (
        <Box key={index} paddingX={1} backgroundColor={isSelected ? color : undefined} overflow="hidden" flexShrink={0}>
            <Text color={isSelected ? theme.ui.background : color} bold={bold} italic={italic} wrap="truncate-end">
                {`${icon} ${label}`}
            </Text>
        </Box>
    );
};
