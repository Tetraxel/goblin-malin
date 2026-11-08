import React, { useRef } from "react";
import { Box, Text, type DOMElement } from "ink";
import { useClickTarget } from "#base/mouse/useMouseTarget";
import { useTheme } from "#base/themeContext";

interface MoreRowProps {
    /** How many results the provider found that aren't listed yet. */
    count: number;
    /** Whether the cursor is on the rows this one belongs to (it is then also reachable from the keyboard). */
    isFocused: boolean;
    width: number;
    onShowMore: () => void;
}

/**
 * Under the last row of a search: the results that were found but not listed. Clicking it lists the
 * next ones (the keyboard shortcut is in the hint bar, resolved from the registry).
 */
export function MoreRow({ count, isFocused, width, onShowMore }: MoreRowProps) {
    const theme = useTheme();
    const rowRef = useRef<DOMElement>(null);
    useClickTarget(rowRef, onShowMore);

    return (
        <Box
            ref={rowRef}
            flexDirection="row"
            width={width}
            minWidth={width}
            height={1}
            flexShrink={0}
            overflow="hidden"
        >
            {/* Lines up with the file names of the rows above (cursor + marker + number columns). */}
            <Box width={6} minWidth={6} flexShrink={0} />
            <Box flexShrink={0} paddingRight={1}>
                <Text color={theme.text.secondary}>↳</Text>
            </Box>
            <Text color={isFocused ? theme.ui.selection : theme.text.secondary} underline wrap="truncate-end">
                {`Show more results (${count} not shown)`}
            </Text>
        </Box>
    );
}
