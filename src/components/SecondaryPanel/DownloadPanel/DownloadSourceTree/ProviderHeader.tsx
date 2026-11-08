import React, { useRef } from "react";
import { Box, Text, type DOMElement } from "ink";
import { useClickTarget } from "#base/mouse/useMouseTarget";
import { useTheme } from "#base/themeContext";

interface ProviderHeaderProps {
    label: string;
    color: string;
    addMargin: boolean;
    width: number;
    /** The cursor is on this header (the whole provider, not one of its rows). */
    isFocused: boolean;
    /** The list has keyboard focus. */
    isActive: boolean;
    onSelect: () => void;
}

export function ProviderHeader({ label, color, addMargin, width, isFocused, isActive, onSelect }: ProviderHeaderProps) {
    const theme = useTheme();
    const rowRef = useRef<DOMElement>(null);
    useClickTarget(rowRef, onSelect);
    const bg = isFocused
        ? isActive
            ? theme.ui.rowBackground.regular.cellActive
            : theme.ui.rowBackground.regular.highlighted
        : undefined;

    return (
        // The margin sits on an outer box so the highlight covers the header row only, not the gap above it.
        <Box flexShrink={0} marginTop={addMargin ? 1 : 0}>
            <Box ref={rowRef} width={width} minWidth={width} height={1} overflow="hidden" backgroundColor={bg}>
                {/* Same cursor column as the rows below, so the label lines up with their marker column. */}
                <Box width={3} minWidth={3} flexShrink={0}>
                    <Text color={theme.ui.focusIndicator}>{isFocused && isActive ? "☛ " : "  "}</Text>
                </Box>
                <Box flexShrink={0}>
                    <Text color={color} bold>
                        {label}
                    </Text>
                </Box>
            </Box>
        </Box>
    );
}
