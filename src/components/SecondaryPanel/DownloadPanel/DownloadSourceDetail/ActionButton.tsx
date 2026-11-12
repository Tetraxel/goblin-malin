import React, { useRef } from "react";
import { Box, Text, type DOMElement } from "ink";
import { useClickTarget, useHoverTarget } from "#base/mouse/useMouseTarget";
import { useTheme } from "#base/themeContext";
import { lighten } from "#utils/color";

/**
 * A filled call-to-action button in the warning colour (brighter under the pointer): for what the user has to do
 * about a problem on screen, such as a file that is gone. Clickable.
 */
export function ActionButton({ label, onClick }: { label: string; onClick: () => void }) {
    const theme = useTheme();
    const ref = useRef<DOMElement>(null);
    useClickTarget(ref, onClick);
    const hovered = useHoverTarget(ref);
    return (
        <Box height={1} flexShrink={0}>
            <Box
                ref={ref}
                paddingX={1}
                flexShrink={0}
                backgroundColor={hovered ? lighten(theme.status.warning, 0.3) : theme.status.warning}
            >
                {/* The text colour that goes with the warning colour as a bar's background (the "File attributes" title). */}
                <Text color={theme.fileAttributes.headerText} bold>
                    {label}
                </Text>
            </Box>
        </Box>
    );
}
