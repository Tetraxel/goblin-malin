import React from "react";
import { Transform } from "ink";
import { hexToAnsiBg } from "#utils/color";

interface WithBackgroundProps {
    color: string;
    children: React.ReactNode;
}

/**
 * Forces a background color to persist through ANSI-manipulating children like ink-gradient,
 * which strip background codes when they re-apply foreground colors.
 */
export const WithBackground: React.FC<WithBackgroundProps> = ({ color, children }) => {
    const bgCode = hexToAnsiBg(color);
    const ESC = "\x1b";
    const transform = (output: string) =>
        bgCode + output.split(`${ESC}[0m`).join(`${ESC}[0m${bgCode}`).split(`${ESC}[39m`).join(`${ESC}[39m${bgCode}`);

    return <Transform transform={transform}>{children}</Transform>;
};
