import React, { useSyncExternalStore } from "react";
import { Box, Text } from "ink";
import { useTheme } from "#base/themeContext";
import { useFocusChrome } from "#contexts/FocusContext";
import { useSettingsVersion } from "#hooks/useSettingsVersion";
import { chatStore } from "#flows/musicDownloadFlow/agent/chatStore";
import { getAgentSettings } from "#flows/musicDownloadFlow/agent/agentSettings";
import { CHAT_AGENT_COLOR } from "./chatPanelState";

export const CHAT_TITLE = "✻ Claude";

/** What follows the title: the model that answers, and how many messages were sent ("sonnet · 3 msg"). */
export function useChatTitleInfo(): string {
    // Only the count: the title must not repaint for every piece of an answer being written.
    const messages = useSyncExternalStore(chatStore.subscribe, () => chatStore.getSnapshot().usage.messages);
    useSettingsVersion();
    const model = getAgentSettings().model;
    return ` · ${model}${messages > 0 ? ` · ${messages} msg` : ""}`;
}

/**
 * The docked chat's title: the rest of the tab line above the main panels, from the divider to the right edge
 * (`── ✻ Claude · sonnet · 3 msg ─────┤`). The line before it ends in `┬`, where the divider starts.
 */
export const ChatTitleBar: React.FC<{ width: number }> = ({ width }) => {
    const theme = useTheme();
    const { activeWindow } = useFocusChrome();
    const focused = activeWindow === "chatPanel";
    const info = useChatTitleInfo();
    // "─ " before, " " after, and the closing "┤".
    const fill = Math.max(0, width - 2 - CHAT_TITLE.length - info.length - 1 - 1);
    return (
        <Box width={width} height={1} flexShrink={0} overflow="hidden">
            {/* Every fixed piece keeps its width: a bare <Text> would shrink to nothing in a narrow panel. */}
            <Box flexShrink={0}>
                <Text color={theme.ui.border}>{"─ "}</Text>
            </Box>
            <Box flexShrink={0}>
                <Text bold color={CHAT_AGENT_COLOR} dimColor={!focused} wrap="truncate-end">
                    {CHAT_TITLE}
                </Text>
            </Box>
            <Text color={theme.text.secondary} wrap="truncate-end">
                {info}
            </Text>
            <Box flexShrink={0}>
                <Text color={theme.ui.border}>{` ${"─".repeat(fill)}┤`}</Text>
            </Box>
        </Box>
    );
};
