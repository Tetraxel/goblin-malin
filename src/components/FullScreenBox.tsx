import React from "react";
import { Box, type DOMElement } from "ink";
import { type ComponentPropsWithoutRef, forwardRef } from "react";

import { useScreenSize } from "../hooks/useScreenSize";

export type BoxProps = ComponentPropsWithoutRef<typeof Box>;

export const FullScreenBox: React.ForwardRefExoticComponent<BoxProps & React.RefAttributes<DOMElement>> = forwardRef<
    DOMElement,
    BoxProps
>(function FullScreenBox(props, ref) {
    // useInput(() => {}); // prevent input from rendering and key=shifting the layout
    const { height, width } = useScreenSize();
    return <Box ref={ref} height={height} width={width} {...props} />;
});
