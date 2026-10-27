import React, { useState } from "react";
import * as fs from "fs";
import * as path from "path";
import open from "open";
import { Box, Text } from "ink";
import { useShortcuts } from "#hooks/useShortcuts";
import { useFocusActions, useFocusChrome } from "#contexts/FocusContext";
import { useTheme } from "#base/themeContext";
import { providerDisplayRegistry } from "#base/providerDisplay";
import { globalLogger } from "#base/logger/logger";
import { Task } from "#base/task/task";
import { SessionManager } from "#sessions/sessionManager";
import { ArchivedEntry, findSavedTaskIds } from "#sessions/archive";
import { getInstance as getPlayer } from "#utils/mpvPlayer";
import { Hint } from "../Hint";
import { SearchBar } from "../SearchBar";
import { HighlightedText } from "../HighlightedText";
import { ConfirmModalConfig } from "../ConfirmModal/useConfirmModal";
import { formatDuration } from "../SecondaryPanel/utils";
import { useArchive } from "./useArchive";

// borders(2) + padding(2) + title(1) + search(4) + list margin(1) + column header(1)
// + detail margin(1) + detail + footer margin(1) + footer(2, may wrap) + outer margins(3)
const DETAIL_HEIGHT = 5;
const MODAL_OVERHEAD = 19 + DETAIL_HEIGHT;
// Beyond this the list just sprawls; it scrolls instead.
const MAX_LIST_HEIGHT = 14;
const DATE_WIDTH = 10;
const SESSION_WIDTH = 18;

interface ArchiveModalProps {
    tasks: Task[];
    terminalHeight: number;
    terminalWidth: number;
    openConfirmModal: (config: ConfirmModalConfig) => void;
}

function formatDay(iso: string): string {
    try {
        return new Date(iso).toLocaleDateString("sv-SE"); // YYYY-MM-DD in local time
    } catch {
        return iso.slice(0, 10);
    }
}

export const ArchiveModal: React.FC<ArchiveModalProps> = ({
    tasks,
    terminalHeight,
    terminalWidth,
    openConfirmModal,
}) => {
    const theme = useTheme();
    const { switchBack, clearSelection } = useFocusActions();
    const { activeWindow, previousWindow } = useFocusChrome();
    const isActive = activeWindow === "archiveModal";
    // Stays rendered underneath a confirm modal opened from here.
    const isVisible = isActive || previousWindow === "archiveModal";

    const [searchQuery, setSearchQuery] = useState("");
    const [modalFocus, setModalFocus] = useState<"search" | "list">("search");
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [scrollTop, setScrollTop] = useState(0);

    const manager = SessionManager.getInstance();
    const { entries, total } = useArchive(searchQuery);

    const listHeight = Math.min(MAX_LIST_HEIGHT, Math.max(3, terminalHeight - MODAL_OVERHEAD));
    const safeIndex = Math.min(selectedIndex, Math.max(0, entries.length - 1));
    const selected: ArchivedEntry | undefined = entries[safeIndex];

    // Keep the cursor inside the visible window.
    let top = Math.min(scrollTop, Math.max(0, entries.length - listHeight));
    if (safeIndex < top) top = safeIndex;
    else if (safeIndex >= top + listHeight) top = safeIndex - listHeight + 1;
    if (top !== scrollTop) setScrollTop(top);

    // The list emptied (last entry deleted or restored) — hand focus back to the search box.
    if (modalFocus === "list" && entries.length === 0) setModalFocus("search");

    const [prevIsVisible, setPrevIsVisible] = useState(isVisible);
    if (prevIsVisible !== isVisible) {
        setPrevIsVisible(isVisible);
        if (isVisible) {
            setSearchQuery("");
            setModalFocus("search");
            setSelectedIndex(0);
            setScrollTop(0);
        }
    }

    const savedCount = isVisible ? findSavedTaskIds(tasks).length : 0;

    function restore(entry: ArchivedEntry) {
        const restored = manager.restoreArchived(entry.sessionId, entry.taskId);
        if (restored === 0) return;
        globalLogger.info(`Restored ${restored} archived task${restored === 1 ? "" : "s"}`);
        clearSelection();
        switchBack();
    }

    function requestDelete(entry: ArchivedEntry) {
        openConfirmModal({
            title: "Delete archived task?",
            message: "This permanently removes its metadata and sources. The saved file is not touched.",
            choices: [
                { label: "Delete", color: theme.status.error },
                { label: "Cancel", color: theme.action.primary },
            ],
            accentColor: theme.status.error,
            onConfirm: (i) => {
                if (i === 0) manager.deleteArchived(entry.sessionId, entry.taskId);
            },
        });
    }

    function play(entry: ArchivedEntry) {
        if (!entry.filePath || !fs.existsSync(entry.filePath)) {
            globalLogger.warn("Archive: the saved file no longer exists");
            return;
        }
        getPlayer()
            .play(entry.filePath)
            .catch(() => {});
    }

    function openFolder(entry: ArchivedEntry) {
        if (!entry.filePath) return;
        open(path.dirname(entry.filePath)).catch(() => {});
    }

    function archiveSaved() {
        const archived = manager.archiveTasks(findSavedTaskIds(tasks));
        if (archived > 0) globalLogger.info(`Archived ${archived} saved task${archived === 1 ? "" : "s"}`);
    }

    useShortcuts({
        id: "archiveModal",
        isActive,
        exclusive: true,
        priority: 300,
        shortcuts: [
            {
                id: "archiveModal.escape",
                defaultShortcut: { key: "escape" },
                label: "Close",
                handler: () => {
                    if (searchQuery) {
                        setSearchQuery("");
                        setModalFocus("search");
                        return;
                    }
                    switchBack();
                },
            },
            {
                id: "archiveModal.up",
                defaultShortcut: { key: "upArrow" },
                label: "Up",
                handler: () => {
                    if (modalFocus !== "list") return;
                    if (safeIndex <= 0) setModalFocus("search");
                    else setSelectedIndex(safeIndex - 1);
                },
            },
            {
                id: "archiveModal.down",
                defaultShortcut: { key: "downArrow" },
                label: "Down",
                handler: () => {
                    if (modalFocus === "search") {
                        if (entries.length > 0) {
                            setModalFocus("list");
                            setSelectedIndex(0);
                        }
                    } else if (safeIndex < entries.length - 1) {
                        setSelectedIndex(safeIndex + 1);
                    }
                },
            },
            {
                id: "archiveModal.enter",
                defaultShortcut: { key: "return" },
                label: "Restore",
                handler: () => {
                    if (modalFocus === "search") {
                        if (entries.length > 0) {
                            setModalFocus("list");
                            setSelectedIndex(0);
                        }
                        return;
                    }
                    if (selected) restore(selected);
                },
            },
            {
                // Plain-key actions below are gated on list focus: in the search box the
                // TextInput owns these keys, and the handler must stay out of its way.
                id: "archiveModal.play",
                defaultShortcut: { input: " " },
                label: "Play",
                handler: () => {
                    if (modalFocus === "list" && selected) play(selected);
                },
            },
            {
                id: "archiveModal.openFolder",
                defaultShortcut: { input: "o" },
                label: "Open folder",
                handler: () => {
                    if (modalFocus === "list" && selected) openFolder(selected);
                },
            },
            {
                id: "archiveModal.delete",
                defaultShortcut: { key: "delete" },
                label: "Delete",
                handler: () => {
                    if (modalFocus === "list" && selected) requestDelete(selected);
                },
            },
            {
                id: "archiveModal.archiveSaved",
                defaultShortcut: { input: "a", ctrl: true },
                label: "Archive saved",
                handler: archiveSaved,
            },
        ],
    });

    if (!isVisible) return null;

    const modalWidth = Math.min(110, Math.max(60, terminalWidth - 6));
    const innerWidth = modalWidth - 6; // border(2) + padding(4)
    const showSession = innerWidth >= 84;
    const fixedWidth = 2 + (DATE_WIDTH + 1) + (showSession ? SESSION_WIDTH + 1 : 0);
    const textWidth = Math.max(10, innerWidth - fixedWidth);
    const artistWidth = Math.floor(textWidth * 0.38);
    const titleWidth = textWidth - artistWidth - 1;

    const cell = (width: number, children: React.ReactNode) => (
        <Box width={width} minWidth={width} flexShrink={0} overflow="hidden">
            {children}
        </Box>
    );

    const visible = entries.slice(top, top + listHeight);

    return (
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
                borderColor={theme.action.primary}
                borderBackgroundColor={theme.ui.background}
                paddingX={2}
                paddingY={1}
                width={modalWidth}
                backgroundColor={theme.ui.background}
                flexShrink={0}
            >
                <Box justifyContent="space-between" flexShrink={0}>
                    <Text bold color={theme.action.primary}>
                        ▤ ARCHIVE
                    </Text>
                    <Text dimColor>
                        {total} task{total !== 1 ? "s" : ""}
                    </Text>
                </Box>

                <SearchBar
                    value={searchQuery}
                    onChange={setSearchQuery}
                    placeholder="Search artist, title, ISRC, session…"
                    highlighted={modalFocus === "search"}
                    inputFocus={modalFocus === "search"}
                />

                {/* Column header */}
                <Box flexDirection="row" flexShrink={0} marginTop={1}>
                    {cell(2, <Text> </Text>)}
                    {cell(artistWidth + 1, <Text dimColor>ARTIST</Text>)}
                    {cell(titleWidth + 1, <Text dimColor>TRACK</Text>)}
                    {cell(DATE_WIDTH + 1, <Text dimColor>DATE</Text>)}
                    {showSession && cell(SESSION_WIDTH, <Text dimColor>SESSION</Text>)}
                </Box>

                {/* List */}
                <Box flexDirection="column" height={listHeight} overflow="hidden" flexShrink={0}>
                    {entries.length === 0 && (
                        <Box paddingX={1}>
                            <Text dimColor>
                                {total === 0
                                    ? "Nothing archived yet. Archive a task from the task list, or use Archive saved."
                                    : "No archived task matches."}
                            </Text>
                        </Box>
                    )}
                    {visible.map((entry, i) => {
                        const idx = top + i;
                        const isSelected = modalFocus === "list" && idx === safeIndex;
                        const color = isSelected ? theme.text.active : theme.text.primary;
                        const title =
                            entry.childCount > 0
                                ? `${entry.title} (${entry.childCount} track${entry.childCount === 1 ? "" : "s"})`
                                : entry.title;
                        return (
                            <Box key={`${entry.sessionId}:${entry.taskId}`} flexDirection="row" flexShrink={0}>
                                {cell(
                                    2,
                                    <Text color={isSelected ? theme.text.active : theme.text.muted}>
                                        {isSelected ? "☛" : " "}
                                    </Text>
                                )}
                                {cell(
                                    artistWidth + 1,
                                    <Text color={color} bold={isSelected} wrap="truncate-end">
                                        <HighlightedText text={entry.artist || "—"} query={searchQuery} />
                                    </Text>
                                )}
                                {cell(
                                    titleWidth + 1,
                                    <Text color={color} bold={isSelected} wrap="truncate-end">
                                        <HighlightedText text={title} query={searchQuery} />
                                    </Text>
                                )}
                                {cell(
                                    DATE_WIDTH + 1,
                                    <Text dimColor wrap="truncate-end">
                                        {formatDay(entry.savedAt ?? entry.archivedAt)}
                                    </Text>
                                )}
                                {showSession &&
                                    cell(
                                        SESSION_WIDTH,
                                        <Text dimColor wrap="truncate-end">
                                            {entry.sessionName}
                                        </Text>
                                    )}
                            </Box>
                        );
                    })}
                </Box>

                {/* Detail of the highlighted entry */}
                <Box
                    flexDirection="column"
                    height={DETAIL_HEIGHT + 1} // + top border
                    flexShrink={0}
                    overflow="hidden"
                    marginTop={1}
                    borderStyle="single"
                    borderColor={theme.ui.separator}
                    borderBackgroundColor={theme.ui.background}
                    borderLeft={false}
                    borderRight={false}
                    borderBottom={false}
                >
                    {selected && <EntryDetail entry={selected} />}
                </Box>

                {/* Footer hints */}
                <Box marginTop={1} flexDirection="row" flexWrap="wrap" flexShrink={0}>
                    {modalFocus === "search" ? (
                        <>
                            <Hint label="Go to list" shortcutIds={["archiveModal.down", "archiveModal.enter"]} />
                            {savedCount > 0 && (
                                <Hint label={`Archive saved (${savedCount})`} shortcutId="archiveModal.archiveSaved" />
                            )}
                            <Hint label="Close" shortcutId="archiveModal.escape" />
                        </>
                    ) : (
                        <>
                            <Hint label="Restore" shortcutId="archiveModal.enter" />
                            <Hint label="Play" shortcutId="archiveModal.play" />
                            <Hint label="Open folder" shortcutId="archiveModal.openFolder" />
                            <Hint label="Delete" shortcutId="archiveModal.delete" />
                            {savedCount > 0 && (
                                <Hint label={`Archive saved (${savedCount})`} shortcutId="archiveModal.archiveSaved" />
                            )}
                            <Hint label="Close" shortcutId="archiveModal.escape" />
                        </>
                    )}
                </Box>
            </Box>
        </Box>
    );
};

const EntryDetail: React.FC<{ entry: ArchivedEntry }> = ({ entry }) => {
    const theme = useTheme();
    const { compiled } = entry;

    const facts =
        entry.kind === "collection"
            ? [entry.childCount > 0 ? `${entry.childCount} archived tracks` : "Album / playlist", entry.artist]
            : [
                  compiled?.album?.albumName,
                  compiled?.year ? String(compiled.year) : undefined,
                  compiled?.duration ? formatDuration(compiled.duration) : undefined,
                  compiled?.isrc ? `ISRC ${compiled.isrc}` : undefined,
              ];

    const fileMissing = !!entry.filePath && !fs.existsSync(entry.filePath);
    const label = (text: string) => (
        <Box width={9} minWidth={9} flexShrink={0}>
            <Text dimColor>{text}</Text>
        </Box>
    );

    return (
        <>
            <Box flexShrink={0}>
                <Text bold color={theme.text.heading} wrap="truncate-end">
                    {entry.artist ? `${entry.artist} – ${entry.title}` : entry.title}
                </Text>
            </Box>
            <Box flexShrink={0}>
                <Text color={theme.text.secondary} wrap="truncate-end">
                    {facts.filter(Boolean).join(" · ") || " "}
                </Text>
            </Box>
            <Box flexDirection="row" flexShrink={0}>
                {label("SAVED")}
                <Text color={entry.filePath ? theme.text.primary : theme.text.muted} wrap="truncate-end">
                    {entry.filePath ?? "not saved"}
                </Text>
                {fileMissing && (
                    <Box flexShrink={0}>
                        <Text color={theme.status.warning}>{" (missing)"}</Text>
                    </Box>
                )}
            </Box>
            <Box flexDirection="row" flexShrink={0} gap={1}>
                {label("SOURCES")}
                {entry.metadataServiceKeys.map((key) => {
                    const display = providerDisplayRegistry.get(key);
                    return (
                        <Box key={key} flexShrink={0}>
                            <Text color={display.color}>{display.acronym}</Text>
                        </Box>
                    );
                })}
                {entry.downloadProvider && (
                    <Box flexShrink={0}>
                        <Text dimColor>{`↓ ${providerDisplayRegistry.get(entry.downloadProvider).label}`}</Text>
                    </Box>
                )}
            </Box>
            <Box flexShrink={0}>
                <Text dimColor wrap="truncate-end">
                    {`Archived ${formatDay(entry.archivedAt)} from "${entry.sessionName}"`}
                </Text>
            </Box>
        </>
    );
};
