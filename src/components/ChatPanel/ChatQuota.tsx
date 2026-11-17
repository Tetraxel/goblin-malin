import React, { useEffect, useSyncExternalStore } from "react";
import { Box, Text } from "ink";
import { useTheme } from "#base/themeContext";
import { claudeQuota, quotaRows } from "#flows/musicDownloadFlow/agent/claudeQuota";

/**
 * How many rows the strip takes: one per window the CLI has reported (5 h, 7 d), none before. A number, so the panel
 * only re-renders when it changes.
 */
export function useQuotaRowCount(): number {
    useEffect(() => {
        // What the last launch saw, shown before the first message of this one.
        void claudeQuota.ensureLoaded();
    }, []);
    return useSyncExternalStore(claudeQuota.subscribe, () => {
        const { fiveHour, sevenDay } = claudeQuota.getSnapshot().windows;
        return (fiveHour ? 1 : 0) + (sevenDay ? 1 : 0);
    });
}

const LABEL_WIDTH = 3; // "5h "
const PERCENT_WIDTH = 5; // " 100%"
const MIN_BAR = 6;
const MAX_BAR = 24;

/**
 * The plan's two usage windows as bars, with the time each resets, at the top of the chat:
 * `5h ████████░░░░░░░░  41%  resets 14:30`. The CLI reports them with every message, so they are those of the last
 * one. No timer: the panel does not repaint for a clock (see CLAUDE.md, performance rules).
 */
export const ChatQuota: React.FC<{ width: number }> = ({ width }) => {
    const theme = useTheme();
    const snapshot = useSyncExternalStore(claudeQuota.subscribe, claudeQuota.getSnapshot);
    const rows = quotaRows(snapshot);
    if (rows.length === 0) return null;

    const resetWidth = Math.max(...rows.map((r) => r.text.length));
    // The bar takes what the text leaves; in a narrow panel the reset time goes first.
    const showReset = width - LABEL_WIDTH - PERCENT_WIDTH - 2 - resetWidth >= MIN_BAR;
    const bar = Math.max(3, Math.min(MAX_BAR, width - LABEL_WIDTH - PERCENT_WIDTH - (showReset ? resetWidth + 2 : 0)));

    return (
        <Box flexDirection="column" flexShrink={0}>
            {rows.map((row) => {
                const filled = Math.round(row.share * bar);
                const color =
                    row.share >= 0.9
                        ? theme.status.error
                        : row.share >= 0.7
                          ? theme.status.warning
                          : theme.status.success;
                return (
                    <Box key={row.label} height={1} flexShrink={0} overflow="hidden">
                        <Box width={LABEL_WIDTH} flexShrink={0}>
                            <Text color={theme.text.secondary}>{row.label}</Text>
                        </Box>
                        <Box width={bar} flexShrink={0}>
                            <Text color={color}>{"█".repeat(filled)}</Text>
                            <Text color={theme.text.secondary} dimColor>
                                {"░".repeat(bar - filled)}
                            </Text>
                        </Box>
                        <Box width={PERCENT_WIDTH} flexShrink={0} justifyContent="flex-end">
                            <Text color={row.reset ? theme.text.secondary : color}>{Math.round(row.share * 100)}%</Text>
                        </Box>
                        {showReset && (
                            <Box marginLeft={2} flexShrink={0}>
                                <Text color={theme.text.secondary} wrap="truncate-end">
                                    {row.text}
                                </Text>
                            </Box>
                        )}
                    </Box>
                );
            })}
        </Box>
    );
};
