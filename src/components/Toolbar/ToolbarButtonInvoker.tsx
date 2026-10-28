import { Box, Text, type DOMElement } from "ink";
import React, { useLayoutEffect, useRef } from "react";
import { ToolbarButtonHook } from "./Toolbar";
import { useToolbarButtonMouse } from "./useToolbarButtonMouse";
import { useHoverTarget } from "#base/mouse/useMouseTarget";
import { useToolbarActionsRef } from "#contexts/ToolbarActionsContext";
import { useTheme } from "#base/themeContext";
import { AnimatedIcon, Icon } from "#components/AnimatedIcon";

export const ToolbarButtonInvoker = ({
    hook,
    isSelected,
    index,
}: {
    hook: ToolbarButtonHook;
    isSelected: boolean;
    index: number;
}) => {
    const theme = useTheme();
    const actionsRef = useToolbarActionsRef();
    const { enabled, label, icon, inProgress, color, bold, italic, onPress } = hook({ isSelected });
    const boxRef = useRef<DOMElement>(null);
    useToolbarButtonMouse(boxRef, index);
    const isHovered = useHoverTarget(boxRef);

    // Register the current onPress for this button index into the shared ref.
    // Runs on every render so the handler always sees the latest closure.
    useLayoutEffect(() => {
        actionsRef.current[index] = onPress;
    });

    if (!enabled) return null;

    const textColor = isSelected ? theme.ui.background : (color as string | undefined);

    return (
        <Box
            ref={boxRef}
            key={index}
            paddingX={1}
            backgroundColor={isSelected ? color : isHovered ? theme.ui.rowBackground.regular.hover : undefined}
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
