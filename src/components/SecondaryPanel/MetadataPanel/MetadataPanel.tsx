import React, { useState, useEffect } from "react";
import { Box, useInput } from "ink";
import { useTheme } from "#base/themeContext";
import { Task, TaskSnapshot } from "#base/task/task";
import { useFocusContext } from "#contexts/FocusContext";
import { MusicDownloadTaskAttributes, MetadataGroupState, MetadataOverrides } from "#flows/musicDownloadFlow/types";
import { computeCompiledMetadata, pickGroupRepresentative } from "#flows/musicDownloadFlow/utils/compiledMetadata";
import { navigableFields } from "#flows/musicDownloadFlow/utils/metadataFields";
import { MetadataSourceList } from "./MetadataSourceList";
import { MetadataDetailPanel } from "./MetadataDetailPanel";
import { SourcesHintBar } from "../SourcesHintBar";

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
    const hintBarHeight = cursor.type === "result" ? 3 : 2;
    const listHeight = height - hintBarHeight;

    useInput(
        (_, key) => {
            if (!isPanelActive || focusState.isEditingField) return;
            if (key.shift && key.leftArrow) {
                setSplitRatio((prev) => Math.max(0.2, prev - 0.04));
                return;
            }
            if (key.shift && key.rightArrow) {
                setSplitRatio((prev) => Math.min(0.75, prev + 0.04));
                return;
            }
            if (!key.shift && key.rightArrow && innerFocus === "list") {
                setSourcesInnerFocus("detail");
            }
            if (!key.shift && key.leftArrow && innerFocus === "detail") {
                setSourcesInnerFocus("list");
            }
        },
        { isActive: isPanelActive }
    );

    useInput(
        (_, key) => {
            if (!isPanelActive || innerFocus !== "detail") return;
            if (key.upArrow) {
                setDetailFieldIndex(Math.max(0, selectedFieldIndex - 1));
            }
            if (key.downArrow) {
                setDetailFieldIndex(Math.min(navigableFields.length - 1, selectedFieldIndex + 1));
            }
        },
        { isActive: isPanelActive && innerFocus === "detail" && !focusState.isEditingField }
    );

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

    // Resolve the selected result for the detail panel
    const sortedGroups = [...groups].sort((a, b) => a.rank - b.rank);
    const selectedResult =
        cursor.type === "result"
            ? sortedGroups[cursor.groupIndex]?.results.sort((a, b) => a.rank - b.rank)[cursor.resultIndex]
            : cursor.type === "group"
              ? sortedGroups[cursor.groupIndex]
                  ? pickGroupRepresentative(sortedGroups[cursor.groupIndex])
                  : undefined
              : undefined;

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
            <SourcesHintBar
                groups={groups}
                cursor={cursor}
                innerFocus={innerFocus}
                isActive={isPanelActive}
                width={width - 2}
            />
        </Box>
    );
};
