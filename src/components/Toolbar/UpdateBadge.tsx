import React, { useLayoutEffect, useRef } from "react";
import { Box, Text, type DOMElement } from "ink";
import { useToolbarButtonMouse } from "./useToolbarButtonMouse";
import { useTheme } from "#base/themeContext";
import { useFocusActions } from "#contexts/FocusContext";
import { useToolbarActionsRef } from "#contexts/ToolbarActionsContext";

export const UpdateBadge: React.FC<{ version: string; isSelected: boolean; index: number }> = ({
    version,
    isSelected,
    index,
}) => {
    const theme = useTheme();
    const { openUpdateModal } = useFocusActions();
    const actionsRef = useToolbarActionsRef();

    useLayoutEffect(() => {
        actionsRef.current[index] = openUpdateModal;
    });

    const boxRef = useRef<DOMElement>(null);
    useToolbarButtonMouse(boxRef, index);

    return (
        <Box ref={boxRef} paddingX={1} backgroundColor={isSelected ? theme.status.success : undefined} flexShrink={0}>
            <Text color={isSelected ? "black" : theme.status.success} bold>
                Update available v{version}
            </Text>
        </Box>
    );
};
