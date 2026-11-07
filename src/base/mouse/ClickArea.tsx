import React, { useRef } from "react";
import { Box, type DOMElement } from "ink";
import type { FocusableWindow } from "#hooks/useFocusManager";
import type { MouseEvent } from "./mouse";
import { getScreenBounds } from "./screenBounds";
import { useClickTarget } from "./useMouseTarget";

type ClickAreaProps = React.ComponentProps<typeof Box> & {
    /** The modal this area lives in; it only reacts while that modal is the focused window. */
    window: FocusableWindow;
    /** `bounds` is the area's absolute screen rectangle, to turn `event.x` into a position within it. */
    onClick: (event: MouseEvent, bounds: { x: number; y: number; width: number; height: number }) => void;
};

/** A `Box` that reacts to left-clicks — the building block for clickable rows inside modals. */
export function ClickArea({ window, onClick, children, ...boxProps }: ClickAreaProps) {
    const ref = useRef<DOMElement>(null);
    useClickTarget(
        ref,
        (event) => {
            const bounds = getScreenBounds(ref.current);
            if (bounds) onClick(event, bounds);
        },
        { window }
    );
    return (
        <Box ref={ref} {...boxProps}>
            {children}
        </Box>
    );
}
