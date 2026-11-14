import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Box } from "ink";
import { useTheme } from "#base/themeContext";
import { type Task, type TaskSnapshot } from "#base/task/task";
import { useFollowTaskSnapshot } from "#hooks/useFollowTaskSnapshot";
import { type CursorPosition, type Updater } from "#hooks/useFocusManager";
import {
    type MusicDownloadTaskAttributes,
    type MetadataGroupState,
    type MetadataOverrides,
} from "#flows/musicDownloadFlow/types";
import { computeCompiledMetadata, pickGroupRepresentative } from "#flows/musicDownloadFlow/utils/compiledMetadata";
import { navigableFields } from "#flows/musicDownloadFlow/utils/metadataFields";
import { pasteRouter } from "#base/pasteRouter";
import { musicBrainzActionItems } from "#flows/musicDownloadFlow/musicbrainz/columnActions";
import { type DownloadTask } from "#flows/musicDownloadFlow/utils/downloadTask";
import { addLinkFromClipboard } from "#flows/musicDownloadFlow/utils/addLinkFromClipboard";
import { canCheckMusicBrainz, isMusicBrainzVerdictStale } from "#flows/musicDownloadFlow/musicbrainz/inputKey";
import { MetadataSourceList } from "./MetadataSourceList";
import { MetadataDetailPanel } from "./MetadataDetailPanel";
import { DynamicHintBar } from "#components/DynamicHintBar/DynamicHintBar";
import { useShortcuts } from "#hooks/useShortcuts";

interface SourcesPanelState {
    cursor: CursorPosition;
    showDiscoverySources: boolean;
    innerFocus: "list" | "detail";
    selectedFieldIndex: number;
}

interface MetadataPanelProps {
    selectedTask: Task | null;
    width: number;
    height: number;
    // Lifted out of FocusContext so this panel can be a memoized, context-free
    // child: every prop below is referentially stable while only the task cursor
    // moves, so React.memo bails out the whole subtree during scroll.
    sourcesPanel: SourcesPanelState;
    isPanelActive: boolean;
    isEditingField: boolean;
    setCursor: (cursor: Updater<CursorPosition>) => void;
    setShowDiscoverySources: (show: boolean) => void;
    setSourcesInnerFocus: (focus: "list" | "detail") => void;
    focusSourcesPane: (pane: "list" | "detail") => void;
    setDetailFieldIndex: (index: Updater<number>) => void;
    setIsEditingField: (editing: boolean) => void;
}

export const MetadataPanel: React.FC<MetadataPanelProps> = React.memo(function MetadataPanel({
    selectedTask,
    width,
    height,
    sourcesPanel,
    isPanelActive,
    isEditingField,
    setCursor,
    setShowDiscoverySources,
    setSourcesInnerFocus,
    focusSourcesPane,
    setDetailFieldIndex,
    setIsEditingField,
}) {
    const theme = useTheme();

    const { cursor, showDiscoverySources, innerFocus, selectedFieldIndex } = sourcesPanel;

    const typedTask = selectedTask as Task<MusicDownloadTaskAttributes> | null;

    const [snapshot, setSnapshot] = useState<TaskSnapshot<MusicDownloadTaskAttributes> | undefined>(
        () => typedTask?.get() as TaskSnapshot<MusicDownloadTaskAttributes> | undefined
    );
    const [prevTypedTask, setPrevTypedTask] = useState(typedTask);
    // A MusicBrainz check is running (shared by the re-check button next to the compiled row and the one in the compiled metadata).
    const [checkingMusicBrainz, setCheckingMusicBrainz] = useState(false);
    if (prevTypedTask !== typedTask) {
        setPrevTypedTask(typedTask);
        setCheckingMusicBrainz(false);
        setSnapshot(typedTask?.get() as TaskSnapshot<MusicDownloadTaskAttributes> | undefined);
    }

    useFollowTaskSnapshot(typedTask, snapshot, setSnapshot);

    // Stable identities while the task snapshot is unchanged (e.g. navigating
    // fields/sources), so `compiled` and the memoized rows below can bail.
    // A collection (album/playlist) task has no metadata sources of its own —
    // select a child track to see its metadata.
    const groups: MetadataGroupState[] = useMemo(
        () => (snapshot?.attributes?.kind === "track" ? snapshot.attributes.metadataGroups : []),
        [snapshot]
    );
    const overrides: MetadataOverrides = useMemo(
        () => (snapshot?.attributes?.kind === "track" ? snapshot.attributes.metadataOverride : {}),
        [snapshot]
    );
    const musicBrainz = useMemo(
        () => (snapshot?.attributes?.kind === "track" ? snapshot.attributes.musicBrainzIdentity : undefined),
        [snapshot]
    );
    const compiled = useMemo(
        () => computeCompiledMetadata(groups, overrides, musicBrainz),
        [groups, overrides, musicBrainz]
    );
    // Whether the MusicBrainz check is out of date with these sources, and whether there is enough to check.
    const musicBrainzStale = isMusicBrainzVerdictStale(musicBrainz, compiled);
    const musicBrainzCheckable = canCheckMusicBrainz(compiled);
    // The re-check button: when the verdict is out of date with the sources, or there is none yet. Shown next to the
    // compiled row (left) and in the compiled metadata (right); both share `checkingMusicBrainz`.
    const showMusicBrainzRecheck = musicBrainzCheckable && (musicBrainzStale || !musicBrainz);
    // What can be done about the verdict, as buttons next to it. The plain "re-check" is left out while the louder
    // "sources changed" button is shown: it would be the same thing twice.
    const musicBrainzActions = useMemo(() => {
        if (!typedTask || snapshot?.attributes?.kind !== "track") return [];
        return musicBrainzActionItems(typedTask as unknown as DownloadTask)
            .filter((item) => !(item.id === "recheck" && showMusicBrainzRecheck))
            .map((item) => ({ id: item.id, label: item.buttonLabel, run: item.run }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [typedTask, musicBrainz, showMusicBrainzRecheck]);

    const [splitRatio, setSplitRatio] = useState(0.6);
    const leftWidth = Math.floor(width * splitRatio) - 4;
    const rightWidth = width - leftWidth - 4;

    // Panel-level shortcuts: resize + focus switch, shown as the lowest-priority hint line.
    useShortcuts({
        id: "metadataPanel",
        isActive: isPanelActive,
        priority: 100,
        shortcuts: [
            {
                id: "metadataPanel.shrink",
                defaultShortcut: { key: "leftArrow", shift: true },
                label: "Shrink",
                handler: () => setSplitRatio((prev) => Math.max(0.2, prev - 0.04)),
            },
            {
                id: "metadataPanel.expand",
                defaultShortcut: { key: "rightArrow", shift: true },
                label: "Expand",
                handler: () => setSplitRatio((prev) => Math.min(0.75, prev + 0.04)),
            },
            {
                id: "metadataPanel.focusDetail",
                defaultShortcut: { key: "rightArrow" },
                label: "Details",
                handler: () => {
                    if (innerFocus === "list") setSourcesInnerFocus("detail");
                },
            },
            {
                id: "metadataPanel.focusList",
                defaultShortcut: { key: "leftArrow" },
                label: "List",
                handler: () => {
                    if (innerFocus === "detail") setSourcesInnerFocus("list");
                },
            },
            {
                id: "metadataPanel.toggleDiscovery",
                defaultShortcut: { input: "e" },
                label: "Toggle search details",
                handler: () => setShowDiscoverySources(!showDiscoverySources),
            },
        ],
        hintLines: [
            {
                id: "metadataPanel.line.panel",
                left: { type: "text", value: "Metadata Panel", bold: true },
                shortcutIds: ["metadataPanel.shrink", "metadataPanel.expand", "metadataPanel.toggleDiscovery"],
            },
        ],
    });

    // Detail-panel navigation shortcuts (only active when detail is focused).
    useShortcuts({
        id: "metadataPanelDetail",
        isActive: isPanelActive && innerFocus === "detail" && !isEditingField,
        priority: 120,
        shortcuts: [
            {
                id: "metadataPanelDetail.up",
                defaultShortcut: { key: "upArrow" },
                label: "Up",
                handler: () => setDetailFieldIndex(Math.max(0, selectedFieldIndex - 1)),
            },
            {
                id: "metadataPanelDetail.down",
                defaultShortcut: { key: "downArrow" },
                label: "Down",
                handler: () => setDetailFieldIndex(Math.min(navigableFields.length - 1, selectedFieldIndex + 1)),
            },
        ],
    });

    // Stable while the task is unchanged so memoized children (FieldRow via
    // onEditSubmit, source rows) bail during field/source navigation.
    const handleGroupsChange = useCallback(
        (updated: MetadataGroupState[]) => typedTask?.updateAttributes({ metadataGroups: updated }),
        [typedTask]
    );

    const handleOverrideChange = useCallback(
        (updated: MetadataOverrides) => typedTask?.updateAttributes({ metadataOverride: updated }),
        [typedTask]
    );

    const handleRefetchResult = useCallback(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (groupIndex: number, resultIndex: number) => (typedTask as any)?.refetchResult?.(groupIndex, resultIndex),
        [typedTask]
    );

    const handleAddLink = useCallback(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const task = typedTask as any;
        if (typeof task?.addUserSources === "function") void addLinkFromClipboard(task);
    }, [typedTask]);

    // Delete (not reject) a link the user added by hand: the row and its durable entry.
    const handleDeleteUserResult = useCallback(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (uri: string) => (typedTask as any)?.removeUserSource?.(uri),
        [typedTask]
    );

    // "Re-check on MusicBrainz": the sources changed since the last check. Resolves when the check is done.
    const handleRecheckMusicBrainz = useCallback(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const task = typedTask as any;
        if (typeof task?.checkMusicBrainz !== "function") return;
        setCheckingMusicBrainz(true);
        void (async () => {
            try {
                await task.checkMusicBrainz();
            } catch {
                /* already logged by the task */
            } finally {
                setCheckingMusicBrainz(false);
            }
        })();
    }, [typedTask]);

    // A link pasted while the sources list has focus (on any of its rows) is added to THIS track as a source — in
    // most terminals Ctrl+V arrives as pasted text, not as a key, so the shortcut alone is not enough.
    const claimsPaste =
        isPanelActive && innerFocus === "list" && !isEditingField && typedTask?.getAttributes()?.kind === "track";
    useEffect(() => {
        if (!claimsPaste || !typedTask) return;
        return pasteRouter.register((text) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            void addLinkFromClipboard(typedTask as any, text);
            return true;
        });
    }, [claimsPaste, typedTask]);

    const handleSkipDiscovery = useCallback(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        () => (typedTask as any)?.skipDiscovery?.(),
        [typedTask]
    );

    // Pointer handlers. While a field is being edited the inline input owns the panel, so
    // clicks and wheel notches that would move the cursor or field underneath it are dropped.
    // Stable identities (like the handlers above) so memoized rows keep bailing out.
    const handleSelectCursor = useCallback(
        (next: CursorPosition) => {
            if (isEditingField) return;
            focusSourcesPane("list");
            setCursor(next);
        },
        [isEditingField, focusSourcesPane, setCursor]
    );
    const handleScrollCursor = useCallback(
        (next: Updater<CursorPosition>) => {
            if (!isEditingField) setCursor(next);
        },
        [isEditingField, setCursor]
    );
    const handleSelectField = useCallback(
        (index: number) => {
            if (isEditingField) return;
            focusSourcesPane("detail");
            setDetailFieldIndex(index);
        },
        [isEditingField, focusSourcesPane, setDetailFieldIndex]
    );
    const handleScrollField = useCallback(
        (next: Updater<number>) => {
            if (!isEditingField) setDetailFieldIndex(next);
        },
        [isEditingField, setDetailFieldIndex]
    );

    const sortedGroups = [...groups].sort((a, b) => a.rank - b.rank);
    const selectedResult =
        cursor.type === "result"
            ? sortedGroups[cursor.groupIndex]?.results.sort((a, b) => a.rank - b.rank)[cursor.resultIndex]
            : cursor.type === "group"
              ? sortedGroups[cursor.groupIndex]
                  ? pickGroupRepresentative(sortedGroups[cursor.groupIndex])
                  : undefined
              : undefined;

    // DynamicHintBar height = number of active hint lines from registry.
    // sourceList contributes 1–2 lines, metadataPanel contributes 1 line.
    const hintBarHeight = cursor.type === "result" ? 3 : 2;
    const listHeight = height - hintBarHeight;

    return (
        <Box
            flexDirection="column"
            height={height}
            overflow="hidden"
            borderStyle="single"
            borderColor={theme.ui.border}
            borderBackgroundColor={theme.ui.background}
            borderTop={false}
            borderBottom={false}
            paddingRight={1}
        >
            <Box flexDirection="row" flexGrow={1} overflow="hidden">
                <MetadataSourceList
                    groups={groups}
                    compiled={compiled}
                    overrides={overrides}
                    cursor={cursor}
                    showDiscoverySources={showDiscoverySources}
                    isActive={isPanelActive && innerFocus === "list"}
                    width={leftWidth}
                    height={listHeight}
                    onCursorChange={setCursor}
                    onSelectCursor={handleSelectCursor}
                    onScrollCursor={handleScrollCursor}
                    onInnerFocusSwitch={() => setSourcesInnerFocus("detail")}
                    onGroupsChange={handleGroupsChange}
                    onToggleDiscoverySources={() => setShowDiscoverySources(!showDiscoverySources)}
                    onRefetchResult={handleRefetchResult}
                    onAddLink={handleAddLink}
                    onDeleteUserResult={handleDeleteUserResult}
                    musicBrainzRecheckLabel={
                        showMusicBrainzRecheck
                            ? musicBrainz
                                ? "↻ Sources changed: re-check on MusicBrainz"
                                : "↻ Check on MusicBrainz"
                            : undefined
                    }
                    checkingMusicBrainz={checkingMusicBrainz}
                    onRecheckMusicBrainz={handleRecheckMusicBrainz}
                    onSkipDiscovery={handleSkipDiscovery}
                    isFetchingPrimarySource={
                        snapshot?.attributes?.kind === "track"
                            ? (snapshot.attributes.primaryMetadataInProgress ?? false)
                            : false
                    }
                    isDiscovering={
                        snapshot?.attributes?.kind === "track"
                            ? (snapshot.attributes.metadataDiscoveringInProgress ?? false)
                            : false
                    }
                />
                <MetadataDetailPanel
                    source={selectedResult ?? "compiled"}
                    compiled={compiled}
                    overrides={overrides}
                    selectedFieldIndex={selectedFieldIndex}
                    isActive={isPanelActive && innerFocus === "detail"}
                    width={rightWidth}
                    height={listHeight}
                    onOverrideChange={handleOverrideChange}
                    onSelectField={handleSelectField}
                    onScrollField={handleScrollField}
                    onInnerFocusSwitch={() => setSourcesInnerFocus("list")}
                    setIsEditingField={setIsEditingField}
                    musicBrainz={musicBrainz}
                    musicBrainzStale={musicBrainzStale}
                    showMusicBrainzRecheck={showMusicBrainzRecheck}
                    checkingMusicBrainz={checkingMusicBrainz}
                    onRecheckMusicBrainz={handleRecheckMusicBrainz}
                    musicBrainzActions={musicBrainzActions}
                />
            </Box>
            <DynamicHintBar width={width - 2} isActive={isPanelActive} />
        </Box>
    );
});
