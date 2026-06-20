import React, { useState } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { useShortcuts } from "#hooks/useShortcuts";
import { useFocusContext } from "#contexts/FocusContext";
import { useTheme } from "#base/themeContext";
import { FlowBase } from "#base/flow/flow-base";
import { FlowOrchestrator } from "#base/flow/flow-orchestrator";
import { SessionStore } from "#sessions/sessionStore";
import { SessionManager } from "#sessions/sessionManager";
import { StoredSession } from "#sessions/types";
import { getSessionMatches, clampToMatch } from "#sessions/sessionSearch";
import { Hint } from "../Hint";
import { SearchBar } from "../SearchBar";
import { HighlightedText } from "../HighlightedText";
import { useSessions } from "./useSessions";
import { ConfirmModalConfig } from "../ConfirmModal/useConfirmModal";

// title(1) + search(4) + footer(1) + margins/border/padding
const MODAL_OVERHEAD = 14;

interface SessionsModalProps {
    terminalHeight: number;
    terminalWidth: number;
    currentFlow: FlowBase | undefined;
    orchestrator: FlowOrchestrator;
    openConfirmModal: (config: ConfirmModalConfig) => void;
}

export const SessionsModal: React.FC<SessionsModalProps> = ({
    terminalHeight,
    terminalWidth,
    currentFlow,
    orchestrator,
    openConfirmModal,
}) => {
    const theme = useTheme();
    const { focusState, switchBack } = useFocusContext();
    const isActive = focusState.activeWindow === "sessionsModal";
    const isVisible = isActive || focusState.previousWindow === "sessionsModal";

    const [searchQuery, setSearchQuery] = useState("");
    const [modalFocus, setModalFocus] = useState<"search" | "list">("search");
    const [selectedIndex, setSelectedIndex] = useState(0);

    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState("");

    const store = SessionStore.getInstance();
    const manager = SessionManager.getInstance();

    const { sessions, currentSessionId } = useSessions(searchQuery);

    const listHeight = Math.max(3, terminalHeight - MODAL_OVERHEAD);
    const safeIndex = Math.min(selectedIndex, Math.max(0, sessions.length - 1));

    const selectedSession: StoredSession | undefined = sessions[safeIndex];

    const [prevIsVisible, setPrevIsVisible] = useState(isVisible);
    if (prevIsVisible !== isVisible) {
        setPrevIsVisible(isVisible);
        if (isVisible) {
            setSearchQuery("");
            setModalFocus("search");
            setSelectedIndex(0);
            setRenamingId(null);
            setRenameValue("");
        }
    }

    function doLoad(session: StoredSession) {
        if (!currentFlow) return;
        manager.loadSession(session.id, currentFlow, orchestrator);
        switchBack();
    }

    function startRename(session: StoredSession) {
        setRenamingId(session.id);
        setRenameValue(session.name);
    }

    function commitRename() {
        if (renamingId && renameValue.trim()) {
            store.renameSession(renamingId, renameValue.trim());
        }
        setRenamingId(null);
        setRenameValue("");
    }

    function cancelRename() {
        setRenamingId(null);
        setRenameValue("");
    }

    function requestDelete(session: StoredSession) {
        openConfirmModal({
            title: "Delete session?",
            message: "This will permanently remove the session from history.",
            choices: [
                { label: "Delete", color: theme.status.error },
                { label: "Cancel", color: theme.action.primary },
            ],
            accentColor: theme.status.error,
            onConfirm: (i) => {
                if (i === 0) {
                    manager.deleteSession(session.id, orchestrator);
                    setSelectedIndex(0);
                }
            },
        });
    }

    useShortcuts({
        id: "sessionsModal",
        isActive,
        exclusive: true,
        priority: 300,
        shortcuts: [
            {
                id: "sessionsModal.escape",
                defaultShortcut: { key: "escape" },
                label: "Close",
                handler: () => {
                    if (renamingId) {
                        cancelRename();
                        return;
                    }
                    if (searchQuery) {
                        setSearchQuery("");
                        setModalFocus("search");
                        return;
                    }
                    switchBack();
                },
            },
            {
                id: "sessionsModal.up",
                defaultShortcut: { key: "upArrow" },
                label: "Up",
                handler: () => {
                    if (renamingId) return;
                    if (modalFocus === "list") {
                        if (safeIndex <= 0) {
                            setModalFocus("search");
                        } else {
                            setSelectedIndex(safeIndex - 1);
                        }
                    }
                },
            },
            {
                id: "sessionsModal.down",
                defaultShortcut: { key: "downArrow" },
                label: "Down",
                handler: () => {
                    if (renamingId) return;
                    if (modalFocus === "search") {
                        if (sessions.length > 0) {
                            setModalFocus("list");
                            setSelectedIndex(0);
                        }
                    } else {
                        if (safeIndex < sessions.length - 1) {
                            setSelectedIndex(safeIndex + 1);
                        }
                    }
                },
            },
            {
                id: "sessionsModal.enter",
                defaultShortcut: { key: "return" },
                label: "Load",
                handler: () => {
                    if (renamingId) {
                        commitRename();
                        return;
                    }
                    if (modalFocus === "search") {
                        if (sessions.length > 0) {
                            setModalFocus("list");
                            setSelectedIndex(0);
                        }
                        return;
                    }
                    if (selectedSession) doLoad(selectedSession);
                },
            },
            {
                id: "sessionsModal.rename",
                defaultShortcut: { input: "r", ctrl: true },
                label: "Rename",
                handler: () => {
                    if (renamingId || modalFocus !== "list") return;
                    if (selectedSession) startRename(selectedSession);
                },
            },
            {
                id: "sessionsModal.new",
                defaultShortcut: { input: "n", ctrl: true },
                label: "New session",
                handler: () => {
                    if (renamingId) return;
                    manager.newSession(orchestrator);
                    switchBack();
                },
            },
            {
                id: "sessionsModal.duplicate",
                defaultShortcut: { input: "d", ctrl: true },
                label: "Duplicate",
                handler: () => {
                    if (renamingId || modalFocus !== "list") return;
                    if (selectedSession && currentFlow) {
                        manager.duplicateSession(selectedSession.id, currentFlow, orchestrator);
                        switchBack();
                    }
                },
            },
            {
                id: "sessionsModal.delete",
                defaultShortcut: { key: "delete" },
                label: "Delete",
                handler: () => {
                    if (renamingId || modalFocus !== "list") return;
                    if (selectedSession) requestDelete(selectedSession);
                },
            },
        ],
    });

    if (!isVisible) return null;

    const modalWidth = Math.min(90, Math.max(60, terminalWidth - 6));
    const innerWidth = modalWidth - 6;
    const isSearching = searchQuery.trim().length > 0;

    function formatDate(iso: string): string {
        try {
            return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
        } catch {
            return iso;
        }
    }

    function getPreview(session: StoredSession): string {
        const first = session.tasks[0];
        if (!first) return "";
        const attrs = first.attributes;
        if (attrs) {
            for (const group of attrs.metadataGroups) {
                const r = group.results.find((r) => r.isPrimaryInput) ?? group.results[0];
                if (r) {
                    const artist = r.metadata.artists[0]?.name;
                    const track = r.metadata.trackName;
                    if (artist && track) return `${artist} – ${track}`;
                    if (track) return track;
                }
            }
            return attrs.userInput?.url ?? "";
        }
        return first.initialInput ?? "";
    }

    return (
        <Box
            position="absolute"
            width="100%"
            height={terminalHeight}
            flexDirection="column"
            justifyContent="center"
            alignItems="center"
            paddingTop={4}
        >
            <Box
                flexDirection="column"
                borderStyle="round"
                borderColor={theme.action.primary}
                borderBackgroundColor={theme.ui.background}
                paddingX={2}
                paddingY={1}
                marginTop={2}
                marginBottom={6}
                width={modalWidth}
                backgroundColor={theme.ui.background}
                flexShrink={0}
            >
                <Box justifyContent="space-between" flexShrink={0}>
                    <Text bold color={theme.action.primary}>
                        SESSIONS
                    </Text>
                    <Text dimColor>
                        {sessions.length} session{sessions.length !== 1 ? "s" : ""}
                    </Text>
                </Box>

                {/* Search bar */}
                <SearchBar
                    value={searchQuery}
                    onChange={setSearchQuery}
                    placeholder="Search sessions…"
                    highlighted={modalFocus === "search" && !renamingId}
                    inputFocus={modalFocus === "search" && !renamingId}
                />

                {/* Session list */}
                <Box flexDirection="column" height={listHeight} overflow="hidden" marginTop={1} flexShrink={0}>
                    {sessions.length === 0 && (
                        <Box paddingX={1}>
                            <Text dimColor>No sessions found.</Text>
                        </Box>
                    )}
                    {sessions.map((session, idx) => {
                        const isCurrent = session.id === currentSessionId;
                        const isSelected = modalFocus === "list" && idx === safeIndex;
                        const isRenaming = renamingId === session.id;

                        const cursorChar = isSelected ? "☛" : " ";
                        const cursorColor = isSelected ? theme.text.active : theme.text.muted;
                        const matches = isSearching ? getSessionMatches(session, searchQuery) : [];

                        return (
                            <Box key={session.id} flexDirection="row" flexShrink={0} marginTop={idx === 0 ? 0 : 1}>
                                <Text color={cursorColor}>{cursorChar} </Text>
                                <Box flexDirection="column" flexGrow={1}>
                                    <Box flexDirection="row" flexShrink={0}>
                                        {isRenaming ? (
                                            <Box flexGrow={1}>
                                                <TextInput value={renameValue} onChange={setRenameValue} focus={true} />
                                            </Box>
                                        ) : (
                                            <Text
                                                bold={isCurrent}
                                                color={isCurrent ? theme.action.primary : theme.text.active}
                                            >
                                                <HighlightedText
                                                    text={session.name}
                                                    query={isSearching ? searchQuery : ""}
                                                />
                                            </Text>
                                        )}
                                        {isCurrent && !isRenaming && (
                                            <Text color={theme.action.primary} bold>
                                                {" ● CURRENT"}
                                            </Text>
                                        )}
                                    </Box>
                                    <Box flexDirection="row" flexShrink={0}>
                                        <Text dimColor>
                                            {formatDate(session.updatedAt)} · {session.tasks.length} track
                                            {session.tasks.length !== 1 ? "s" : ""}
                                        </Text>
                                        {!isSearching && session.tasks.length > 0 && (
                                            <Text dimColor>
                                                {" · "}
                                                {getPreview(session).slice(0, innerWidth - 40)}
                                            </Text>
                                        )}
                                    </Box>
                                    {matches.map((m, i) => (
                                        <Box key={`${m.field}-${i}`} paddingLeft={3} flexShrink={0}>
                                            <Text wrap="truncate-end">
                                                <Text dimColor>{`└─ ${m.field}: `}</Text>
                                                <HighlightedText
                                                    text={clampToMatch(
                                                        m.value,
                                                        searchQuery,
                                                        Math.max(10, innerWidth - 12)
                                                    )}
                                                    query={searchQuery}
                                                    color={theme.text.muted}
                                                />
                                            </Text>
                                        </Box>
                                    ))}
                                </Box>
                            </Box>
                        );
                    })}
                </Box>

                {/* Footer hints */}
                <Box marginTop={1} flexDirection="row" flexWrap="wrap" flexShrink={0}>
                    {renamingId ? (
                        <>
                            <Hint label="Confirm" shortcutId="sessionsModal.enter" />
                            <Hint label="Cancel" shortcutId="sessionsModal.escape" />
                        </>
                    ) : modalFocus === "search" ? (
                        <>
                            <Hint label="Go to list" shortcutIds={["sessionsModal.down", "sessionsModal.enter"]} />
                            <Hint label="New" shortcutId="sessionsModal.new" />
                            <Hint label="Close" shortcutId="sessionsModal.escape" />
                        </>
                    ) : (
                        <>
                            <Hint label="Load" shortcutId="sessionsModal.enter" />
                            <Hint label="Rename" shortcutId="sessionsModal.rename" />
                            <Hint label="New" shortcutId="sessionsModal.new" />
                            <Hint label="Duplicate" shortcutId="sessionsModal.duplicate" />
                            <Hint label="Delete" shortcutId="sessionsModal.delete" />
                            <Hint label="Close" shortcutId="sessionsModal.escape" />
                        </>
                    )}
                </Box>
            </Box>
        </Box>
    );
};
