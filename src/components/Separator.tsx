import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "#base/themeContext";

export interface SeparatorProps {
    width: number;
    type?: "top" | "bottom" | "middle";
    splitPositions?: number[];
    splitCharacter?: string;
}

export const Separator: React.FC<SeparatorProps> = ({ width, type = "middle", splitPositions, splitCharacter }) => {
    const theme = useTheme();
    // Sort the positions to process them in order
    const sortedSplits = splitPositions?.sort((a, b) => a - b) ?? [];

    let startChar: string;
    let endChar: string;
    let splitChar: string;
    const lineChar = "─";

    switch (type) {
        case "top":
            startChar = "┌";
            endChar = "┐";
            splitChar = "┬";
            break;
        case "bottom":
            startChar = "└";
            endChar = "┘";
            splitChar = "┴";
            break;
        case "middle":
        default:
            startChar = "├";
            endChar = "┤";
            splitChar = "┼";
            break;
    }

    if (splitCharacter) splitChar = splitCharacter;

    const separatorChars = new Array(width).fill(lineChar); // 1. Set the boundary characters

    separatorChars[0] = startChar; // Check to prevent index out of bounds if width is too small (e.g., < 2)
    if (width > 1) {
        separatorChars[width - 1] = endChar;
    } // 2. Insert the split characters (vertical dividers)

    for (const position of sortedSplits) {
        // Ensure the position is within the bounds and doesn't overwrite a boundary
        if (position > 0 && position < width - 1) {
            separatorChars[position] = splitChar;
        }
    } // Join the array back into a single string

    const separatorText = separatorChars.join("");

    return (
        <Box flexDirection="row" height={1} width={width} overflow="hidden">
            <Text color={theme.ui.border}>{separatorText}</Text>
        </Box>
    );
};
