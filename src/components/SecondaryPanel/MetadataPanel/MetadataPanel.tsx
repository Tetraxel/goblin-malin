import React, { useState, useEffect } from "react";
import { Box } from "ink";
import { useTheme } from "#base/themeContext";
import { Task, TaskSnapshot } from "#base/task/task";
import { useFocusContext } from "#contexts/FocusContext";
import { MusicDownloadTaskAttributes, MetadataGroupState, MetadataOverrides } from "#flows/musicDownloadFlow/types";
import { computeCompiledMetadata, pickGroupRepresentative } from "#flows/musicDownloadFlow/utils/compiledMetadata";
import { navigableFields } from "#flows/musicDownloadFlow/utils/metadataFields";
import { MetadataSourceList } from "./MetadataSourceList";
import { MetadataDetailPanel } from "./MetadataDetailPanel";
import { DynamicHintBar } from "#components/DynamicHintBar/DynamicHintBar";
import { useShortcuts } from "#hooks/useShortcuts";

interface MetadataPanelProps {
    selectedTask: Task | null;
    width: number;
    height: number;
}

export const MetadataPanel: React.FC<MetadataPanelProps> = ({ selectedTask, width, height }) => {
    const theme = useTheme();
    const { focusState, setCursor, setShowDiscoverySources, setSourcesInnerFocus, setDetailFieldIndex } =
        useFocusContext();

    const { sourcesPanel } = focusState.secondaryPanel;
    const { cursor, showDiscoverySources, innerFocus, selectedFieldIndex } = sourcesPanel;

    const isPanelActive =
        focusState.activeWindow === "secondaryPanel" && focusState.secondaryPanel.subTab === "sources";

    const typedTask = selectedTask as Task<MusicDownloadTaskAttributes> | null;

    const [snapshot, setSnapshot] = useState<TaskSnapshot<MusicDownloadTaskAttributes> | undefined>(
        () => typedTask?.get() as TaskSnapshot<MusicDownloadTaskAttributes> | undefined
    );
    const [prevTypedTask, setPrevTypedTask] = useState(typedTask);
    if (prevTypedTask !== typedTask) {
        setPrevTypedTask(typedTask);
        setSnapshot(typedTask?.get() as TaskSnapshot<MusicDownloadTaskAttributes> | undefined);
    }

    useEffect(() => {
        if (!typedTask) return;
        return (typedTask as Task<MusicDownloadTaskAttributes>).subscribe((t) => {
            setSnapshot(t.get() as TaskSnapshot<MusicDownloadTaskAttributes>);
        });
    }, [typedTask]);

    const groups: MetadataGroupState[] = snapshot?.attributes?.metadataGroups ?? [];
    const overrides: MetadataOverrides = snapshot?.attributes?.metadataOverride ?? {};
    const compiled = computeCompiledMetadata(groups, overrides);

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
        isActive: isPanelActive && innerFocus === "detail" && !focusState.isEditingField,
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

    function handleGroupsChange(updated: MetadataGroupState[]) {
        typedTask?.updateAttributes({ metadataGroups: updated });
    }

    function handleOverrideChange(updated: MetadataOverrides) {
        typedTask?.updateAttributes({ metadataOverride: updated });
    }

    function handleRefetchResult(groupIndex: number, resultIndex: number) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (typedTask as any)?.refetchResult?.(groupIndex, resultIndex);
    }

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
                    onInnerFocusSwitch={() => setSourcesInnerFocus("detail")}
                    onGroupsChange={handleGroupsChange}
                    onToggleDiscoverySources={() => setShowDiscoverySources(!showDiscoverySources)}
                    onRefetchResult={handleRefetchResult}
                    isFetchingPrimarySource={snapshot?.attributes?.primaryMetadataInProgress ?? false}
                    isDiscovering={snapshot?.attributes?.metadataDiscoveringInProgress ?? false}
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
                    onInnerFocusSwitch={() => setSourcesInnerFocus("list")}
                />
            </Box>
            <DynamicHintBar width={width - 2} isActive={isPanelActive} />
        </Box>
    );
};
