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

// title(1) + search(4) + footer(1) + margins/border/padding
const MODAL_OVERHEAD = 14;

interface SessionsModalProps {
    terminalHeight: number;
    terminalWidth: number;
    currentFlow: FlowBase | undefined;
    orchestrator: FlowOrchestrator;
}

export const SessionsModal: React.FC<SessionsModalProps> = ({
    terminalHeight,
    terminalWidth,
    currentFlow,
    orchestrator,
}) => {
    const theme = useTheme();
    const { focusState, switchBack } = useFocusContext();
    const isActive = focusState.activeWindow === "sessionsModal";

    const [searchQuery, setSearchQuery] = useState("");
    const [modalFocus, setModalFocus] = useState<"search" | "list">("search");
    const [selectedIndex, setSelectedIndex] = useState(0);

    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState("");

    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
    const [confirmChoice, setConfirmChoice] = useState(0);

    const store = SessionStore.getInstance();
    const manager = SessionManager.getInstance();

    const { sessions, currentSessionId } = useSessions(searchQuery);

    const listHeight = Math.max(3, terminalHeight - MODAL_OVERHEAD);
    const safeIndex = Math.min(selectedIndex, Math.max(0, sessions.length - 1));

    const selectedSession: StoredSession | undefined = sessions[safeIndex];

    const [prevIsActive, setPrevIsActive] = useState(isActive);
    if (prevIsActive !== isActive) {
        setPrevIsActive(isActive);
        if (isActive) {
            setSearchQuery("");
            setModalFocus("search");
            setSelectedIndex(0);
            setRenamingId(null);
            setRenameValue("");
            setConfirmDeleteId(null);
            setConfirmChoice(0);
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
        setConfirmDeleteId(session.id);
        setConfirmChoice(0);
    }

    function resolveDelete() {
        if (confirmChoice === 0 && confirmDeleteId) {
            manager.deleteSession(confirmDeleteId, orchestrator);
            setSelectedIndex(0);
        }
        setConfirmDeleteId(null);
    }

    const isBlocked = renamingId !== null || confirmDeleteId !== null;

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
                    if (confirmDeleteId) {
                        setConfirmDeleteId(null);
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
                    if (isBlocked) return;
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
                    if (isBlocked) return;
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
                    if (confirmDeleteId) {
                        resolveDelete();
                        return;
                    }
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
                id: "sessionsModal.left",
                defaultShortcut: { key: "leftArrow" },
                label: "Previous choice",
                handler: () => {
                    if (confirmDeleteId) {
                        setConfirmChoice((c) => (c + 1) % 2);
                    }
                },
            },
            {
                id: "sessionsModal.right",
                defaultShortcut: { key: "rightArrow" },
                label: "Next choice",
                handler: () => {
                    if (confirmDeleteId) {
                        setConfirmChoice((c) => (c + 1) % 2);
                    }
                },
            },
            {
                id: "sessionsModal.rename",
                defaultShortcut: { input: "r", ctrl: true },
                label: "Rename",
                handler: () => {
                    if (isBlocked || modalFocus !== "list") return;
                    if (selectedSession) startRename(selectedSession);
                },
            },
            {
                id: "sessionsModal.new",
                defaultShortcut: { input: "n", ctrl: true },
                label: "New session",
                handler: () => {
                    if (isBlocked) return;
                    manager.newSession(orchestrator);
                    switchBack();
                },
            },
            {
                id: "sessionsModal.duplicate",
                defaultShortcut: { input: "d", ctrl: true },
                label: "Duplicate",
                handler: () => {
                    if (isBlocked || modalFocus !== "list") return;
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
                    if (isBlocked || modalFocus !== "list") return;
                    if (selectedSession) requestDelete(selectedSession);
                },
            },
        ],
    });

    if (!isActive) return null;

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
        <>
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
                        highlighted={modalFocus === "search" && !isBlocked}
                        inputFocus={modalFocus === "search" && !isBlocked}
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
                                                    <TextInput
                                                        value={renameValue}
                                                        onChange={setRenameValue}
                                                        focus={true}
                                                    />
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
                                <Hint label="Confirm" shortcut="Enter" />
                                <Hint label="Cancel" shortcut="Esc" />
                            </>
                        ) : modalFocus === "search" ? (
                            <>
                                <Hint label="Go to list" shortcut="↓/Enter" />
                                <Hint label="New" shortcut="Ctrl+N" />
                                <Hint label="Close" shortcut="Esc" />
                            </>
                        ) : (
                            <>
                                <Hint label="Load" shortcut="Enter" />
                                <Hint label="Rename" shortcut="Ctrl+R" />
                                <Hint label="New" shortcut="Ctrl+N" />
                                <Hint label="Duplicate" shortcut="Ctrl+D" />
                                <Hint label="Delete" shortcut="DEL" />
                                <Hint label="Close" shortcut="Esc" />
                            </>
                        )}
                    </Box>
                </Box>
            </Box>

            {/* Delete confirmation */}
            {confirmDeleteId && (
                <Box
                    position="absolute"
                    width="100%"
                    height={terminalHeight}
                    flexDirection="column"
                    justifyContent="center"
                    alignItems="center"
                >
                    <Box
                        flexDirection="column"
                        borderStyle="round"
                        borderColor={theme.status.error}
                        borderBackgroundColor={theme.ui.background}
                        backgroundColor={theme.ui.background}
                        paddingX={2}
                        paddingY={1}
                        width={Math.min(60, modalWidth)}
                    >
                        <Text bold color={theme.status.error}>
                            Delete session?
                        </Text>
                        <Box marginTop={1}>
                            <Text>This will permanently remove the session from history.</Text>
                        </Box>
                        <Box marginTop={1} flexDirection="row">
                            {(["Delete", "Cancel"] as const).map((label, i) => {
                                const selected = i === confirmChoice;
                                return (
                                    <Box key={label} marginRight={2} flexShrink={0}>
                                        <Text
                                            bold={selected}
                                            color={selected ? theme.ui.background : theme.text.muted}
                                            backgroundColor={
                                                selected
                                                    ? i === 0
                                                        ? theme.status.error
                                                        : theme.action.primary
                                                    : undefined
                                            }
                                        >
                                            {` ${label} `}
                                        </Text>
                                    </Box>
                                );
                            })}
                        </Box>
                        <Box marginTop={1} flexDirection="row">
                            <Hint label="Choose" shortcut="←→" />
                            <Hint label="Confirm" shortcut="Enter" />
                            <Hint label="Cancel" shortcut="Esc" />
                        </Box>
                    </Box>
                </Box>
            )}
        </>
    );
};
