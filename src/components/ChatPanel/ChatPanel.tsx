import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Box, Text, type DOMElement } from "ink";
import clipboard from "clipboardy";
import { useTheme } from "#base/themeContext";
import { useClickTarget, useWheelTarget } from "#base/mouse/useMouseTarget";
import { mouseRegistry } from "#base/mouse/mouse";
import { setClickThroughWindow } from "#base/mouse/clickableWindows";
import { getVisibleScreenBounds } from "#base/mouse/screenBounds";
import { pasteRouter } from "#base/pasteRouter";
import { type Task } from "#base/task/task";
import { useFocusActions, useFocusChrome } from "#contexts/FocusContext";
import { useShortcuts } from "#hooks/useShortcuts";
import { useSettingsVersion } from "#hooks/useSettingsVersion";
import { agentChat } from "#flows/musicDownloadFlow/agent/agentChat";
import { chatStore } from "#flows/musicDownloadFlow/agent/chatStore";
import { chooseAgentModel } from "#flows/musicDownloadFlow/agent/chooseAgentModel";
import { getAgentSettings } from "#flows/musicDownloadFlow/agent/agentSettings";
import { type SavedChatSummary } from "#flows/musicDownloadFlow/agent/chatHistory";
import { Hint } from "../Hint";
import { ChatEmptyState } from "./ChatEmptyState";
import { ChatInput, type ChatInputHandle } from "./ChatInput";
import { readClipboard } from "#components/ImportModal/clipboard";
import { ChatQuota, useQuotaRowCount } from "./ChatQuota";
import { ChatRowView } from "./ChatRowView";
import { ChatSelection } from "./ChatSelection";
import { CHAT_TITLE, useChatTitleInfo } from "./ChatTitleBar";
import { inputRowCount, sanitizeTyped } from "./inputLayout";
import {
    CHAT_AGENT_COLOR as AGENT_COLOR,
    CHAT_PANEL_WIDTH_STEP,
    chatPanelState,
    chatViewMemory,
    clampChatWidth,
} from "./chatPanelState";
import { formatChatRows, lastAnswer, maxScroll, visibleRows } from "./formatChat";

// What is under the conversation: a blank row, the status line, a blank row, the hints. The text line adds its own
// rows. A window over the screen has a title and a frame of its own (3 more rows); the docked panel shares the app's
// frame, and its title is on the tab line.
const HINT_ROWS = 4;
const CHROME_ROWS = 1 + 1 + 1 + HINT_ROWS;
// Rows moved per wheel notch, per ↑/↓ press (PageUp/PageDown move a page).
const WHEEL_ROWS = 3;
// How long a message ("Copied") stays on the status line.
const FLASH_MS = 2500;
// Columns on the panel's left edge that start a resize when pressed.
const GRAB_COLUMNS = 2;

type Props = {
    tasks: Task[];
    width: number;
    height: number;
    /** `docked`: beside the task list. `modal`: over the whole screen (a narrow terminal). */
    variant: "docked" | "modal";
    /** The terminal's width: how far a docked panel can be widened. */
    terminalWidth: number;
};

/**
 * The chat with Claude: its answers, the tools it calls (live, and openable to see what was sent and received), and
 * a line to type in. Docked at the right of the task list, or a window over the screen in a narrow terminal. The
 * conversation lives in `chatStore`, so closing the panel loses nothing.
 */
export const ChatPanel: React.FC<Props> = ({ tasks, width, height, variant, terminalWidth }) => {
    const theme = useTheme();
    const { switchWindow } = useFocusActions();
    const { activeWindow } = useFocusChrome();
    const isFocused = activeWindow === "chatPanel";

    const chat = useSyncExternalStore(chatStore.subscribe, chatStore.getSnapshot);
    // Start from what the last panel had (see `chatViewMemory`): it is remounted by a resize across the dock width.
    const [draft, setDraft] = useState(() => chatViewMemory.draft);
    const [scroll, setScroll] = useState(() => chatViewMemory.scroll);
    useEffect(() => {
        chatViewMemory.draft = draft;
        chatViewMemory.scroll = scroll;
    }, [draft, scroll]);
    const [flash, setFlash] = useState<{ text: string; ok: boolean } | undefined>();
    const [last, setLast] = useState<SavedChatSummary | undefined>();
    const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const ref = useRef<DOMElement>(null);
    const inputRef = useRef<ChatInputHandle>(null);
    const bodyRef = useRef<DOMElement>(null);

    useSettingsVersion();
    const model = getAgentSettings().model;
    const titleInfo = useChatTitleInfo();

    // What the user has selected in the app, for the header of the next message. Written by ChatSelection, the only
    // part that follows the task list's cursor: the chat itself does not re-render while the cursor moves.
    const selectionRef = useRef<string[]>([]);

    // The docked panel has a border on its right only (the task list's right border is its left one); a window has
    // four. Padding: three columns, so the text does not touch the frame.
    const docked = variant === "docked";
    const innerWidth = Math.max(10, width - (docked ? 1 : 2) - 3);
    const inputWidth = Math.max(4, innerWidth - 2);
    const inputRows = inputRowCount(draft, inputWidth);
    const quotaRows = useQuotaRowCount();
    const bodyHeight = Math.max(1, height - CHROME_ROWS - (docked ? 0 : 3) - inputRows - quotaRows);
    const rows = useMemo(() => formatChatRows(chat.messages, innerWidth), [chat.messages, innerWidth]);
    const limit = maxScroll(rows.length, bodyHeight);
    const offset = Math.min(scroll, limit);
    const shown = visibleRows(rows, bodyHeight, offset);
    const fresh = chat.messages.length === 0;

    // A reply is read as it is written: at the bottom the view follows it. Scrolled up, what is being read stays
    // where it is, so the offset grows with what is added below.
    const [prevCount, setPrevCount] = useState(rows.length);
    if (prevCount !== rows.length) {
        setPrevCount(rows.length);
        if (scroll !== 0) setScroll(Math.max(0, scroll + rows.length - prevCount));
    }

    // The last conversation, to offer it again whenever the chat is empty (a new launch, or after /new).
    useEffect(() => {
        if (!fresh) return;
        let cancelled = false;
        void agentChat.lastConversation().then((summary) => {
            if (!cancelled) setLast(summary);
        });
        return () => {
            cancelled = true;
        };
    }, [fresh]);

    const submit = useCallback(
        (value: string) => {
            const text = value.trim();
            if (text === "" || chat.busy) return;
            setDraft("");
            setScroll(0);
            void agentChat.send(text, selectionRef.current);
        },
        [chat.busy]
    );

    const close = useCallback(() => {
        chatPanelState.setOpen(false);
        switchWindow("taskList");
    }, [switchWindow]);

    const showFlash = useCallback((text: string, ok: boolean) => {
        setFlash({ text, ok });
        clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => setFlash(undefined), FLASH_MS);
        flashTimer.current.unref?.();
    }, []);
    useEffect(() => () => clearTimeout(flashTimer.current), []);

    // Claude's last answer, as written (Markdown), on the system clipboard.
    const copyAnswer = useCallback(() => {
        const text = lastAnswer(chatStore.getSnapshot().messages);
        if (text === "") {
            showFlash("Nothing to copy yet", false);
            return;
        }
        clipboard.write(text).then(
            () => showFlash(`Copied Claude's answer (${text.length} characters)`, true),
            () => showFlash("Could not reach the clipboard", false)
        );
    }, [showFlash]);

    // Ctrl+V, for the terminals that deliver the key instead of typing the clipboard into the app (the others never
    // get here: what they paste arrives as text, straight into the line). The line is one row of text: the clipboard
    // goes in at the cursor, without the line break a copied line usually ends with.
    const paste = useCallback(() => {
        readClipboard().then(
            (raw) => {
                const text = raw.replace(/[\r\n]+$/, "");
                if (text.trim() === "") {
                    showFlash("The clipboard is empty", false);
                    return;
                }
                if (inputRef.current) inputRef.current.insert(text);
                else setDraft((d) => d + sanitizeTyped(text));
            },
            () => showFlash("Could not read the clipboard", false)
        );
    }, [showFlash]);

    // The model is Claude Code's choice per session: it can be changed until the first message is sent.
    const chooseModel = useCallback(() => {
        const snapshot = chatStore.getSnapshot();
        if (snapshot.messages.some((m) => m.role === "user")) {
            showFlash("The model is chosen before the first message (/new starts over).", false);
            return;
        }
        if (snapshot.busy) return;
        void chooseAgentModel(AGENT_COLOR);
    }, [showFlash]);

    const reopenLast = useCallback(() => {
        if (chatStore.getSnapshot().messages.length === 0) void agentChat.reopenLast();
    }, []);

    const resize = useCallback(
        (columns: number) => {
            if (variant !== "docked") return;
            chatPanelState.setWidth(clampChatWidth(width + columns, terminalWidth));
        },
        [variant, width, terminalWidth]
    );

    const scrollBy = useCallback(
        (rowsBack: number) => setScroll((s) => Math.max(0, Math.min(limit, s + rowsBack))),
        [limit]
    );
    const page = Math.max(1, bodyHeight - 1);

    useShortcuts({
        id: "chatPanel",
        isActive: isFocused,
        exclusive: true,
        priority: 200,
        shortcuts: [
            {
                id: "chat.escape",
                defaultShortcut: { key: "escape" },
                label: "Stop / back to tasks",
                // While Claude works Esc stops it; otherwise it hands the keyboard back to the task list (a window
                // over the screen has nothing to hand back to: it closes).
                handler: () =>
                    chat.busy ? agentChat.stop() : variant === "modal" ? close() : switchWindow("taskList"),
            },
            {
                id: "chat.focusTasks",
                defaultShortcut: { key: "tab" },
                label: "Back to tasks",
                handler: () => (variant === "modal" ? close() : switchWindow("taskList")),
            },
            {
                id: "chat.toggle",
                defaultShortcut: { input: "t", ctrl: true },
                label: "Close the chat",
                handler: close,
            },
            {
                id: "chat.undo",
                defaultShortcut: { input: "z", ctrl: true },
                label: "Undo Claude's last action",
                handler: () => void agentChat.undo(),
            },
            {
                id: "chat.paste",
                defaultShortcut: { input: "v", ctrl: true },
                label: "Paste the clipboard into the message",
                handler: paste,
            },
            {
                id: "chat.copy",
                defaultShortcut: { input: "c", ctrl: true },
                label: "Copy Claude's last answer",
                handler: copyAnswer,
            },
            {
                id: "chat.details",
                defaultShortcut: { input: "o", ctrl: true },
                label: "Show or hide what the tool calls sent and received",
                handler: () => chatStore.toggleAllTools(),
            },
            {
                id: "chat.model",
                defaultShortcut: { input: "l", ctrl: true },
                label: "Choose Claude's model (before the first message)",
                handler: chooseModel,
            },
            {
                id: "chat.reopen",
                defaultShortcut: { input: "r", ctrl: true },
                label: "Reopen the last conversation",
                handler: reopenLast,
            },
            {
                id: "chat.scrollUp",
                defaultShortcut: { key: "pageUp" },
                label: "Scroll up",
                handler: () => scrollBy(page),
            },
            {
                id: "chat.scrollDown",
                defaultShortcut: { key: "pageDown" },
                label: "Scroll down",
                handler: () => scrollBy(-page),
            },
            {
                id: "chat.lineUp",
                defaultShortcut: { key: "upArrow" },
                label: "Scroll up a few lines",
                handler: () => scrollBy(WHEEL_ROWS),
            },
            {
                id: "chat.lineDown",
                defaultShortcut: { key: "downArrow" },
                label: "Scroll down a few lines",
                handler: () => scrollBy(-WHEEL_ROWS),
            },
            {
                id: "chat.widen",
                defaultShortcut: { key: "leftArrow", shift: true },
                label: "Make the chat wider",
                handler: () => resize(CHAT_PANEL_WIDTH_STEP),
            },
            {
                id: "chat.narrow",
                defaultShortcut: { key: "rightArrow", shift: true },
                label: "Make the chat narrower",
                handler: () => resize(-CHAT_PANEL_WIDTH_STEP),
            },
        ],
    });

    // While Claude answers the line is not an input, so a pasted text would fall through to "import links": it goes
    // to the draft instead. (A focused input keeps its own paste; the dispatcher leaves it alone.)
    useEffect(() => {
        if (!isFocused) return;
        return pasteRouter.register((text) => {
            setDraft((d) => d + sanitizeTyped(text));
            return true;
        });
    }, [isFocused]);

    // Dragging the panel's left edge resizes it. Only a docked panel has an edge to move. The subscription is made
    // once (resizing re-renders the panel on every cell: a subscription tied to the width would end the drag), so
    // it reads the current sizes from a ref.
    const sizes = useRef({ width, terminalWidth });
    useEffect(() => {
        sizes.current = { width, terminalWidth };
    });
    useEffect(() => {
        if (variant !== "docked") return;
        let drag: { startX: number; startWidth: number } | undefined;
        return mouseRegistry.subscribe((event) => {
            if (event.type === "press" && event.button === "left") {
                const bounds = getVisibleScreenBounds(ref.current);
                const onEdge =
                    bounds &&
                    event.y >= bounds.y &&
                    event.y < bounds.y + bounds.height &&
                    // The divider is the task list's right border, one column to the left of the panel.
                    event.x >= bounds.x - 1 &&
                    event.x < bounds.x - 1 + GRAB_COLUMNS;
                drag = onEdge ? { startX: event.x, startWidth: sizes.current.width } : undefined;
            } else if (drag && event.type === "move" && event.button === "left") {
                const target = drag.startWidth + drag.startX - event.x;
                chatPanelState.setWidth(clampChatWidth(target, sizes.current.terminalWidth));
            } else if (drag && (event.type === "release" || event.type === "move")) {
                drag = undefined;
            }
        });
    }, [variant]);

    // A docked panel does not take the screen: a click on the task list, the toolbar or the panels below goes to
    // them (and takes the keyboard there), without Esc first. A window over the screen is modal, so it does not.
    useEffect(() => {
        if (!docked) return;
        setClickThroughWindow("chatPanel", true);
        return () => setClickThroughWindow("chatPanel", false);
    }, [docked]);

    const mouseWindow = docked ? undefined : { window: "chatPanel" as const };
    useClickTarget(ref, () => switchWindow("chatPanel"), mouseWindow);
    // A click on a tool line (or on its opened details) opens or closes it. The rows sit at the bottom of the body.
    useClickTarget(
        bodyRef,
        (event) => {
            const bounds = getVisibleScreenBounds(bodyRef.current);
            if (!bounds) return;
            const id = shown[event.y - (bounds.y + bounds.height - shown.length)]?.toggleId;
            if (id !== undefined) chatStore.toggleTool(id);
        },
        mouseWindow
    );
    // The wheel never moves the keyboard focus, so it works whichever window has it.
    const onWheel = useCallback((delta: number) => scrollBy(-delta * WHEEL_ROWS), [scrollBy]);
    useWheelTarget(ref, onWheel, mouseWindow);

    return (
        <Box
            ref={ref}
            flexDirection="column"
            width={width}
            height={height}
            flexShrink={0}
            // Docked, the panel is part of the app's frame: the same single line in the same colour, shared with the
            // task list on its left, closed by the toolbar's tab line above and the footer's line below. A window
            // over the screen looks like the other windows.
            borderStyle={docked ? "single" : "round"}
            borderColor={docked ? theme.ui.border : theme.action.primary}
            borderLeft={!docked}
            borderTop={!docked}
            borderBottom={!docked}
            borderBackgroundColor={theme.ui.background}
            backgroundColor={theme.ui.background}
            paddingLeft={2}
            paddingRight={1}
            overflow="hidden"
        >
            {/* Docked, the title is on the tab line above (ChatTitleBar). */}
            {!docked && (
                <Box height={1} flexShrink={0}>
                    <Box flexShrink={0}>
                        <Text bold color={AGENT_COLOR} dimColor={!isFocused}>
                            {CHAT_TITLE}
                        </Text>
                    </Box>
                    <Text color={theme.text.secondary} wrap="truncate-end">
                        {titleInfo}
                    </Text>
                </Box>
            )}

            {/* How much of the plan's 5-hour and 7-day usage is left, as the last message reported it. */}
            {quotaRows > 0 && <ChatQuota width={innerWidth} />}

            <Box
                ref={bodyRef}
                flexDirection="column"
                height={bodyHeight}
                flexShrink={0}
                overflow="hidden"
                justifyContent="flex-end"
            >
                {fresh ? (
                    <ChatEmptyState
                        model={model}
                        last={last}
                        onChooseModel={chooseModel}
                        onReopen={reopenLast}
                        mouse={mouseWindow}
                    />
                ) : (
                    shown.map((row) => <ChatRowView key={row.key} row={row} width={innerWidth} />)
                )}
            </Box>

            <Box height={1} flexShrink={0} />

            <Box height={1} flexShrink={0}>
                {offset > 0 ? (
                    <Text color={theme.text.secondary} wrap="truncate-end">
                        ↓ {offset} more row{offset === 1 ? "" : "s"} below
                    </Text>
                ) : flash ? (
                    <Text color={flash.ok ? theme.status.success : theme.status.error} wrap="truncate-end">
                        {flash.text}
                    </Text>
                ) : chat.busy ? (
                    <Text color={AGENT_COLOR} wrap="truncate-end">
                        {/* Not animated: a spinner would repaint the whole screen several times a second for as long as Claude works. */}
                        ✻ {chat.activity || "Thinking…"}
                    </Text>
                ) : null}
                {/* Always mounted: it keeps `selectionRef` current even while the chip is not drawn. */}
                <ChatSelection tasks={tasks} selectionRef={selectionRef} show={offset === 0 && !flash && !chat.busy} />
            </Box>

            <Box height={inputRows} flexShrink={0}>
                <Box width={2} flexShrink={0} alignItems="flex-start">
                    <Text color={isFocused ? AGENT_COLOR : theme.text.secondary}>{chat.busy ? "…" : "›"}</Text>
                </Box>
                <ChatInput
                    ref={inputRef}
                    value={draft}
                    onChange={setDraft}
                    onSubmit={submit}
                    focus={isFocused && !chat.busy}
                    placeholder={chat.busy ? "" : "Message Claude"}
                    width={inputWidth}
                    color={theme.text.primary}
                />
            </Box>

            <Box height={1} flexShrink={0} />

            <Box flexShrink={0} overflow="hidden" flexWrap="wrap" height={HINT_ROWS}>
                {/* Enter is owned by the text field, not by the shortcut registry. */}
                {!chat.busy && <Hint label="Send" shortcut="Enter" />}
                <Hint label={chat.busy ? "Stop" : variant === "modal" ? "Close" : "Tasks"} shortcutId="chat.escape" />
                <Hint label="Scroll" shortcutIds={["chat.scrollUp", "chat.scrollDown"]} />
                <Hint label="Details" shortcutId="chat.details" />
                <Hint label="Paste" shortcutId="chat.paste" />
                <Hint label="Copy" shortcutId="chat.copy" />
                {fresh && <Hint label="Model" shortcutId="chat.model" />}
                {variant === "docked" && <Hint label="Width" shortcutIds={["chat.widen", "chat.narrow"]} />}
                {variant === "docked" && <Hint label="Close" shortcutId="chat.toggle" />}
            </Box>
        </Box>
    );
};
