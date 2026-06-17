import React from "react";
import { Text } from "ink";
import { useTheme } from "#base/themeContext";

type TextColor = React.ComponentProps<typeof Text>["color"];

/**
 * Renders `text`, emphasising every (case-insensitive) occurrence of `query`
 * in `highlightColor` (yellow by default). Non-matching segments use `color`,
 * or inherit the surrounding <Text> when omitted. Intended to be nested inside
 * a parent <Text>.
 */
export function HighlightedText({
    text,
    query,
    color,
    highlightColor,
}: {
    text: string;
    query: string;
    color?: TextColor;
    highlightColor?: TextColor;
}) {
    const theme = useTheme();
    const hl = highlightColor ?? theme.palette.yellow;
    const q = query.trim();

    if (!q) return <Text color={color}>{text}</Text>;

    const lowerText = text.toLowerCase();
    const lowerQuery = q.toLowerCase();
    const parts: React.ReactNode[] = [];
    let cursor = 0;
    let key = 0;

    while (cursor < text.length) {
        const idx = lowerText.indexOf(lowerQuery, cursor);
        if (idx === -1) {
            parts.push(
                <Text key={key++} color={color}>
                    {text.slice(cursor)}
                </Text>
            );
            break;
        }
        if (idx > cursor) {
            parts.push(
                <Text key={key++} color={color}>
                    {text.slice(cursor, idx)}
                </Text>
            );
        }
        parts.push(
            <Text key={key++} color={hl} bold>
                {text.slice(idx, idx + q.length)}
            </Text>
        );
        cursor = idx + q.length;
    }

    return <>{parts}</>;
}
