import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "#base/themeContext";
import { CHAT_AGENT_COLOR } from "./chatPanelState";
import { MARKER_WIDTH, type ChatRow } from "./formatChat";

/**
 * One row of the conversation. Memoized: a row keeps the very same object while its text does not change, so an
 * answer being written repaints its last line, not the hundred above it.
 */
export const ChatRowView = React.memo(function ChatRowView({ row, width }: { row: ChatRow; width: number }) {
    const theme = useTheme();
    const isUser = row.role === "user";
    const color = isUser
        ? theme.action.primary
        : row.role === "error"
          ? theme.status.error
          : row.role === "tool"
            ? row.state === "failed"
                ? theme.status.error
                : theme.text.secondary
            : row.role === "note"
              ? theme.text.secondary
              : theme.text.primary;
    // A tool line says how it ended in its marker: running ⚙, done ✓, failed ✗.
    const marker =
        row.role === "tool" && row.marker
            ? row.state === "done"
                ? "✓"
                : row.state === "failed"
                  ? "✗"
                  : "⚙"
            : row.marker;
    const textWidth = Math.max(1, width - MARKER_WIDTH - row.indent);
    return (
        // What the user wrote stands on a grey band (its blank rows above and below belong to it).
        <Box
            width={width}
            height={1}
            flexShrink={0}
            overflow="hidden"
            backgroundColor={isUser ? theme.ui.rowBackground.regular.activeDimmed : undefined}
        >
            <Box width={MARKER_WIDTH} flexShrink={0}>
                <Text color={row.role === "tool" && row.state === "done" ? theme.status.success : color} bold={isUser}>
                    {marker}
                </Text>
            </Box>
            {row.indent > 0 && (
                // A list item's bullet sits at its nesting, the text starts after it.
                <Box width={row.indent} flexShrink={0}>
                    <Box marginLeft={row.nest} flexShrink={0}>
                        <Text color={row.dim ? theme.text.secondary : CHAT_AGENT_COLOR}>{row.lead}</Text>
                    </Box>
                </Box>
            )}
            {row.rule ? (
                <Text color={theme.text.secondary} wrap="truncate-end">
                    {"─".repeat(textWidth)}
                </Text>
            ) : (
                <Text
                    color={row.dim ? theme.text.secondary : color}
                    bold={isUser}
                    dimColor={row.role === "note" || row.dim}
                    wrap="truncate-end"
                >
                    {row.text}
                </Text>
            )}
        </Box>
    );
});
