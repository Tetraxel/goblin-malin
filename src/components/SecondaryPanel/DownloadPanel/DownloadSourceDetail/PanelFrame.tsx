import React from "react";
import { Box, Text, type DOMElement } from "ink";
import { useTheme } from "#base/themeContext";

/**
 * A bordered panel whose title sits in the top edge (`┌──── TITLE ────┐`). Its rows go in a viewport box
 * that fills the panel and clips what does not fit; `viewportRef` lets the caller measure that box.
 */
export function PanelFrame({
    title,
    color,
    width,
    grow,
    viewportRef,
    children,
}: {
    title: string;
    color: string;
    width: number;
    /** Fill the height left by its siblings. Only meaningful inside a column; in a row panels stretch anyway. */
    grow?: boolean;
    viewportRef?: React.RefObject<DOMElement | null>;
    children: React.ReactNode;
}) {
    const theme = useTheme();
    // "┌", dashes, " title ", dashes, "┐" add up to exactly `width`.
    const dashes = Math.max(0, width - title.length - 4);
    const left = Math.floor(dashes / 2);
    return (
        <Box flexDirection="column" width={width} flexShrink={grow ? 1 : 0} flexGrow={grow ? 1 : 0} overflow="hidden">
            <Box flexDirection="row" height={1} flexShrink={0} overflow="hidden">
                <Text color={color}>{`┌${"─".repeat(left)} `}</Text>
                <Text color={color} bold>
                    {title}
                </Text>
                <Text color={color}>{` ${"─".repeat(dashes - left)}┐`}</Text>
            </Box>
            <Box
                flexDirection="column"
                flexGrow={1}
                overflow="hidden"
                borderStyle="single"
                borderColor={color}
                borderBackgroundColor={theme.ui.background}
                borderTop={false}
            >
                <Box ref={viewportRef} flexDirection="column" flexGrow={1} overflow="hidden">
                    {children}
                </Box>
            </Box>
        </Box>
    );
}
