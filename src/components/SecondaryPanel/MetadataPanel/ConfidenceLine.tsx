import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "#base/themeContext";
import { type ConfidencePart } from "#flows/musicDownloadFlow/types";
import { wrapText } from "#utils/wrapText";

/** Lines of the breakdown shown under a result: the score's parts, wrapped; more than this are cut with "…". */
const SCORE_LINES = 3;
const LINE_INDENT = 14;
const LABEL = "score ";

/** "Title +40", or "Artist 0 (different artists)": a part that gave nothing says why. */
function formatPart(part: ConfidencePart): string {
    const sign = part.points > 0 ? `+${part.points}` : part.points < 0 ? `−${-part.points}` : "0";
    const why = part.points <= 0 && part.detail ? ` (${part.detail})` : "";
    return `${part.label} ${sign}${why}`;
}

interface ConfidenceLineProps {
    parts: ConfidencePart[];
    /** The score the parts add up to, as the row's badge shows it. */
    score: number | undefined;
    dimmed?: boolean;
    /** Width of the row this line sits under. */
    width?: number;
}

/**
 * How a result's confidence badge adds up (title, artist, duration, year, version): the answer to "why is this one 0%".
 * Shown with the "found by" lines, under them.
 */
export const ConfidenceLine: React.FC<ConfidenceLineProps> = ({ parts, score, dimmed, width }) => {
    const theme = useTheme();
    if (parts.length === 0) return null;
    const total = score !== undefined ? `${score}%  ` : "";
    const text = `${total}${parts.map(formatPart).join(" · ")}`;
    const lines = wrapText(text, Math.max(20, (width ?? 100) - LINE_INDENT - 3 - LABEL.length - 3), SCORE_LINES);

    return (
        <Box marginLeft={LINE_INDENT} flexDirection="row" flexShrink={0}>
            <Box flexShrink={0}>
                <Text color={theme.text.secondary} dimColor={dimmed}>
                    {"└─ "}
                </Text>
            </Box>
            <Box flexShrink={0}>
                <Text color={theme.text.muted} dimColor={dimmed}>
                    {LABEL}
                </Text>
            </Box>
            <Box flexDirection="column" flexShrink={0}>
                {lines.map((line, i) => (
                    <Text key={i} color={theme.text.secondary} dimColor={dimmed} wrap="truncate-end">
                        {line}
                    </Text>
                ))}
            </Box>
        </Box>
    );
};
