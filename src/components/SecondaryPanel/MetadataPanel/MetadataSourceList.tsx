import React, { useRef } from "react";
import { Box, Text, type DOMElement } from "ink";
import Spinner from "ink-spinner";
import { useWheelTarget } from "#base/mouse/useMouseTarget";
import { useTheme } from "#base/themeContext";
import { MetadataGroupState, MetadataOverrides } from "#flows/musicDownloadFlow/types";
import { CompiledMetadata } from "#flows/musicDownloadFlow/utils/compiledMetadata";
import { CursorPosition, Updater } from "#hooks/useFocusManager";
import { stepCursor, useSourceListInput } from "./useSourceListInput";
import { MetadataGroupHeader } from "./MetadataGroupHeader";
import { MetadataResultRow } from "./MetadataResultRow";
import { MetadataCompiledRow } from "./MetadataCompiledRow";

interface MetadataSourceListProps {
    groups: MetadataGroupState[];
    compiled: CompiledMetadata;
    overrides: MetadataOverrides;
    cursor: CursorPosition;
    showDiscoverySources: boolean;
    isActive: boolean;
    width: number;
    height: number;
    onCursorChange: (cursor: CursorPosition) => void;
    /** A row was clicked: focus the list and move the cursor there. Must be referentially stable. */
    onSelectCursor: (cursor: CursorPosition) => void;
    /** Mouse-wheel: move the cursor without moving keyboard focus. */
    onScrollCursor: (cursor: Updater<CursorPosition>) => void;
    onInnerFocusSwitch: () => void;
    onGroupsChange: (groups: MetadataGroupState[]) => void;
    onToggleDiscoverySources: () => void;
    onRefetchResult: (groupIndex: number, resultIndex: number) => void;
    isFetchingPrimarySource?: boolean;
    isDiscovering?: boolean;
}

const HEADER_LINE = "Top-ranked favorite sources are more likely to be used for downloading";

const getLoadingText = (isFetchingPrimarySource: boolean, isDiscovering: boolean) => {
    if (isFetchingPrimarySource) return "Fetching primary source…";
    if (isDiscovering) return "Discovering on other platforms…";
    return "";
};

export const MetadataSourceList: React.FC<MetadataSourceListProps> = ({
    groups,
    compiled,
    overrides,
    cursor,
    showDiscoverySources,
    isActive,
    width,
    height,
    onCursorChange,
    onSelectCursor,
    onScrollCursor,
    onInnerFocusSwitch,
    onGroupsChange,
    onToggleDiscoverySources,
    onRefetchResult,
    isFetchingPrimarySource = false,
    isDiscovering = false,
}) => {
    const theme = useTheme();
    const sortedGroups = [...groups].sort((a, b) => a.rank - b.rank);

    const listRef = useRef<DOMElement>(null);
    useWheelTarget(listRef, (delta) => onScrollCursor((prev) => stepCursor(prev, sortedGroups, delta)));

    useSourceListInput({
        groups,
        sortedGroups,
        cursor,
        isActive,
        onCursorChange,
        onInnerFocusSwitch,
        onGroupsChange,
        onToggleDiscoverySources,
        onRefetchResult,
    });

    const overrideCount = Object.keys(overrides).filter(
        (k) => overrides[k as keyof MetadataOverrides] !== undefined
    ).length;

    return (
        <Box ref={listRef} flexDirection="column" width={width} height={height} overflow="hidden">
            <Box flexDirection="row" height={1} marginBottom={1} overflow="hidden">
                <Text color="gray" italic wrap="truncate-end">
                    {" " + HEADER_LINE}
                </Text>
            </Box>
            <Box flexDirection="column" flexGrow={1} gap={1} overflow="hidden">
                {/* Compiled row */}
                <MetadataCompiledRow
                    compiled={compiled}
                    overrideCount={overrideCount}
                    onSelect={onSelectCursor}
                    isSelected={cursor.type === "compiled"}
                    isActive={isActive}
                    width={width}
                />
                {/* Groups */}
                {sortedGroups.map((group, gIdx) => {
                    const sortedResults = [...group.results].sort((a, b) => a.rank - b.rank);
                    return (
                        <Box key={group.serviceKey} flexDirection="column" overflow="hidden">
                            <MetadataGroupHeader
                                group={group}
                                groupIndex={gIdx}
                                onSelect={onSelectCursor}
                                isSelected={cursor.type === "group" && cursor.groupIndex === gIdx}
                                isActive={isActive}
                            />
                            {sortedResults.map((result, rIdx) => (
                                <MetadataResultRow
                                    key={rIdx}
                                    result={result}
                                    serviceKey={group.serviceKey}
                                    groupIndex={gIdx}
                                    resultIndex={rIdx}
                                    onSelect={onSelectCursor}
                                    isSelected={
                                        cursor.type === "result" &&
                                        cursor.groupIndex === gIdx &&
                                        cursor.resultIndex === rIdx
                                    }
                                    isActive={isActive}
                                    width={width}
                                    showDiscoverySources={showDiscoverySources}
                                />
                            ))}
                        </Box>
                    );
                })}
                {(isFetchingPrimarySource || isDiscovering) && (
                    <Box flexDirection="row" height={1} paddingLeft={3} flexShrink={0}>
                        <Box flexDirection="row" paddingRight={1} flexShrink={0}>
                            <Text color={theme.text.secondary}>
                                <Spinner type="dots" />
                            </Text>
                        </Box>
                        <Text color={theme.text.secondary}>
                            {getLoadingText(isFetchingPrimarySource, isDiscovering)}
                        </Text>
                    </Box>
                )}
            </Box>
        </Box>
    );
};
