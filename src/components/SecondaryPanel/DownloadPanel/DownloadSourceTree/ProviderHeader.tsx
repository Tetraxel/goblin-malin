import React from "react";
import { Box, Text } from "ink";

interface ProviderHeaderProps {
    label: string;
    color: string;
    addMargin: boolean;
}

export function ProviderHeader({ label, color, addMargin }: ProviderHeaderProps) {
    return (
        <Box paddingLeft={1} marginTop={addMargin ? 1 : 0}>
            <Text color={color} bold>
                {label}
            </Text>
        </Box>
    );
}
