import React, { useLayoutEffect } from "react";
import { Box, Text } from "ink";
import { useTheme } from "#base/themeContext";
import { useFocusContext } from "#contexts/FocusContext";
import { useToolbarActionsRef } from "#contexts/ToolbarActionsContext";

export const UpdateBadge: React.FC<{ version: string; isSelected: boolean; index: number }> = ({
    version,
    isSelected,
    index,
}) => {
    const theme = useTheme();
    const { openUpdateModal } = useFocusContext();
    const actionsRef = useToolbarActionsRef();

    useLayoutEffect(() => {
        actionsRef.current[index] = openUpdateModal;
    });

    return (
        <Box paddingX={1} backgroundColor={isSelected ? theme.status.success : undefined} flexShrink={0}>
            <Text color={isSelected ? "black" : theme.status.success} bold>
                Update available v{version}
            </Text>
        </Box>
    );
};
