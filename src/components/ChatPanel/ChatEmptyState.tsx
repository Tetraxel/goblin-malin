import React, { useRef } from "react";
import { Box, Text, type DOMElement } from "ink";
import { useTheme } from "#base/themeContext";
import { useClickTarget, useHoverTarget, type MouseTargetOptions } from "#base/mouse/useMouseTarget";
import { type SavedChatSummary } from "#flows/musicDownloadFlow/agent/chatHistory";
import { CHAT_COMMANDS } from "#flows/musicDownloadFlow/agent/agentChat";
import { Hint } from "../Hint";
import { CHAT_AGENT_COLOR } from "./chatPanelState";
import { timeAgo } from "./timeAgo";

/** A line that can be clicked: underlined while the pointer is over it. */
const ChatButton: React.FC<{
    onPress: () => void;
    mouse?: MouseTargetOptions;
    children: (hovered: boolean) => React.ReactNode;
}> = ({ onPress, mouse, children }) => {
    const ref = useRef<DOMElement>(null);
    useClickTarget(ref, onPress, mouse);
    const hovered = useHoverTarget(ref, mouse);
    return (
        <Box ref={ref} flexShrink={0} flexDirection="row" overflow="hidden">
            {children(hovered)}
        </Box>
    );
};

type Props = {
    model: string;
    /** The last saved conversation, if there is one to reopen. */
    last: SavedChatSummary | undefined;
    onChooseModel: () => void;
    onReopen: () => void;
    mouse?: MouseTargetOptions;
};

/**
 * What the chat shows before the first message: what to ask, which model will answer (changeable now, not once the
 * conversation has started), and a button to bring back the last conversation. A new launch always starts empty:
 * resuming a conversation costs the plan's usage, so it is the user's choice.
 */
export const ChatEmptyState: React.FC<Props> = ({ model, last, onChooseModel, onReopen, mouse }) => {
    const theme = useTheme();
    const dim = theme.text.secondary;
    return (
        <Box flexDirection="column">
            <Text color={dim} wrap="truncate-end">
                Ask about your tasks, or find music:
            </Text>
            <Text color={dim} wrap="truncate-end">
                “fix the titles of these tracks”
            </Text>
            <Text color={dim} wrap="truncate-end">
                “which tracks have no source?”
            </Text>
            <Text color={dim} wrap="truncate-end">
                “find the remixes of Neverender”
            </Text>
            <Text color={dim} wrap="truncate-end">
                {CHAT_COMMANDS.undo} reverts the last change
            </Text>
            <Text color={dim} wrap="truncate-end">
                {CHAT_COMMANDS.new} starts a new conversation
            </Text>

            <Box height={1} flexShrink={0} />
            <ChatButton onPress={onChooseModel} mouse={mouse}>
                {(hovered) => (
                    <>
                        <Text color={dim}>Model </Text>
                        <Text bold color={CHAT_AGENT_COLOR} underline={hovered}>
                            {model}
                        </Text>
                        <Box marginLeft={2} flexShrink={0}>
                            <Hint label="Change" shortcutId="chat.model" />
                        </Box>
                    </>
                )}
            </ChatButton>

            {last && (
                <>
                    <Box height={1} flexShrink={0} />
                    <ChatButton onPress={onReopen} mouse={mouse}>
                        {(hovered) => (
                            <>
                                <Text bold color={CHAT_AGENT_COLOR} underline={hovered}>
                                    ↺ Reopen the last conversation
                                </Text>
                            </>
                        )}
                    </ChatButton>
                    <Text color={dim} wrap="truncate-end">
                        {last.messages} message{last.messages === 1 ? "" : "s"} · {timeAgo(last.savedAt)}
                    </Text>
                    {last.firstUserMessage !== "" && (
                        <Text color={dim} italic wrap="truncate-end">
                            “{last.firstUserMessage}”
                        </Text>
                    )}
                    <Box flexShrink={0}>
                        <Hint label="Reopen" shortcutId="chat.reopen" />
                    </Box>
                </>
            )}
        </Box>
    );
};
