import React, { useRef } from "react";
import { Box, Text, type DOMElement } from "ink";
import Spinner from "ink-spinner";
import { useClickTarget, useHoverTarget, useWheelTarget } from "#base/mouse/useMouseTarget";
import { useTheme } from "#base/themeContext";
import { type MetadataGroupState, type MetadataOverrides } from "#flows/musicDownloadFlow/types";
import { type CompiledMetadata } from "#flows/musicDownloadFlow/utils/compiledMetadata";
import { type CursorPosition, type Updater } from "#hooks/useFocusManager";
import { stepCursor, useSourceListInput } from "./useSourceListInput";
import { MetadataGroupHeader } from "./MetadataGroupHeader";
import { MetadataResultRow } from "./MetadataResultRow";
import { MetadataCompiledRow } from "./MetadataCompiledRow";
import { MusicBrainzRecheckButton } from "./MusicBrainzRecheckButton";

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
    /** Add the link in the clipboard to this track as a source. Must be referentially stable. */
    onAddLink: () => void;
    /** Delete a link the user added by hand (`uri` = the row's `metadata.uri`). Must be referentially stable. */
    onDeleteUserResult: (uri: string) => void;
    /** The label of the MusicBrainz re-check button under the compiled row; undefined = no button. */
    musicBrainzRecheckLabel?: string;
    /** A MusicBrainz check is running. */
    checkingMusicBrainz?: boolean;
    /** Run the MusicBrainz check again. Must be referentially stable. */
    onRecheckMusicBrainz?: () => void;
    /** Stop discovering and keep the sources found so far. Must be referentially stable. */
    onSkipDiscovery: () => void;
    isFetchingPrimarySource?: boolean;
    isDiscovering?: boolean;
}

const HEADER_LINE = "Top-ranked favorite sources are more likely to be used for downloading";

const getLoadingText = (isFetchingPrimarySource: boolean, isDiscovering: boolean) => {
    if (isFetchingPrimarySource) return "Fetching primary source…";
    if (isDiscovering) return "Discovering on other platforms…";
    return "";
};

const SkipDiscoveryButton = React.memo(function SkipDiscoveryButton({ onSkip }: { onSkip: () => void }) {
    const theme = useTheme();
    const ref = useRef<DOMElement>(null);
    useClickTarget(ref, onSkip);
    const isHovered = useHoverTarget(ref);
    return (
        <Box
            ref={ref}
            marginLeft={1}
            paddingX={1}
            flexShrink={0}
            backgroundColor={isHovered ? theme.ui.rowBackground.regular.hover : undefined}
        >
            <Text color={theme.text.active} bold>
                Skip ⏭
            </Text>
        </Box>
    );
});

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
    onAddLink,
    onDeleteUserResult,
    musicBrainzRecheckLabel,
    checkingMusicBrainz = false,
    onRecheckMusicBrainz,
    onSkipDiscovery,
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
        onAddLink,
        onDeleteUserResult,
    });

    // Skipping only makes sense once there is something to keep.
    const canSkipDiscovery = isDiscovering && !isFetchingPrimarySource && groups.some((g) => g.results.length > 0);

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
                {/* Compiled row, and under it the MusicBrainz re-check button when the sources changed */}
                <Box flexDirection="column" flexShrink={0}>
                    <MetadataCompiledRow
                        compiled={compiled}
                        overrideCount={overrideCount}
                        onSelect={onSelectCursor}
                        isSelected={cursor.type === "compiled"}
                        isActive={isActive}
                        width={width}
                    />
                    {musicBrainzRecheckLabel && onRecheckMusicBrainz && (
                        <Box paddingLeft={3} flexShrink={0}>
                            <MusicBrainzRecheckButton
                                label={musicBrainzRecheckLabel}
                                busy={checkingMusicBrainz}
                                onRecheck={onRecheckMusicBrainz}
                            />
                        </Box>
                    )}
                </Box>
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
                    <Box flexDirection="row" height={1} paddingLeft={3} flexShrink={0} overflow="hidden">
                        <Box flexDirection="row" paddingRight={1} flexShrink={0}>
                            <Text color={theme.text.secondary}>
                                <Spinner type="dots" />
                            </Text>
                        </Box>
                        <Text color={theme.text.secondary} wrap="truncate-end">
                            {getLoadingText(isFetchingPrimarySource, isDiscovering)}
                        </Text>
                        {canSkipDiscovery && <SkipDiscoveryButton onSkip={onSkipDiscovery} />}
                    </Box>
                )}
            </Box>
        </Box>
    );
};
