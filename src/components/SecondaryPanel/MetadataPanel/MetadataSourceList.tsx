import React, { useRef } from "react";
import { Box, Text, type DOMElement } from "ink";
import { AnimatedIcon, Icon } from "#components/AnimatedIcon";
import { useWheelTarget } from "#base/mouse/useMouseTarget";
import { providerDisplayRegistry } from "#base/providerDisplay";
import { useTheme } from "#base/themeContext";
import { type MetadataGroupState, type MetadataOverrides } from "#flows/musicDownloadFlow/types";
import { type CompiledMetadata } from "#flows/musicDownloadFlow/utils/compiledMetadata";
import { type CursorPosition, type Updater } from "#hooks/useFocusManager";
import { stepCursor, useSourceListInput } from "./useSourceListInput";
import { MetadataGroupHeader } from "./MetadataGroupHeader";
import { MetadataResultRow } from "./MetadataResultRow";
import { MetadataCompiledRow } from "./MetadataCompiledRow";
import { MusicBrainzRecheckButton } from "./MusicBrainzRecheckButton";
import { GroupSearchRow, LastResortButton, SkipButton, emptyGroupText } from "./MetadataGroupStatus";

/** A last-resort service (Claude) the user can ask for the platforms still missing, as the list shows it. */
export interface LastResortOfferView {
    key: string;
    /** The registry keys of the platforms it would look for. */
    missing: string[];
}

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
    /** Stop waiting for one platform's search (its group's Skip). Must be referentially stable. */
    onSkipSearch: (serviceKey: string) => void;
    /** The last-resort services the user can start now (empty: no button). */
    lastResortOffers: LastResortOfferView[];
    /** The key of the last-resort service that is running for this track, if any. */
    lastResortBusyKey?: string;
    /** Ask a last-resort service to look for the missing platforms. Must be referentially stable. */
    onAskLastResort: (serviceKey: string) => void;
    /** Stops the last-resort service running for this track (the busy button's click). Must be stable. */
    onStopLastResort: () => void;
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
    onAddLink,
    onDeleteUserResult,
    musicBrainzRecheckLabel,
    checkingMusicBrainz = false,
    onRecheckMusicBrainz,
    onSkipDiscovery,
    onSkipSearch,
    lastResortOffers,
    lastResortBusyKey,
    onAskLastResort,
    onStopLastResort,
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
    // While platforms are being searched each has its own Skip: this one then ends everything that is left.
    const skipAllLabel = groups.some((g) => g.search === "searching") ? "Skip all ⏭" : undefined;

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
            {/* (A blank line between blocks is a margin, not a `gap`: groups with nothing in them stack tightly.) */}
            <Box flexDirection="column" flexShrink={1} overflow="hidden">
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
                    // Nothing to list in it (yet): a run of such groups is packed, a blank line only before and after.
                    const previousIsEmpty = gIdx > 0 && sortedGroups[gIdx - 1].results.length === 0;
                    const marginTop = sortedResults.length === 0 && previousIsEmpty ? 0 : 1;
                    // (not while the primary source is being fetched: its group is empty until it arrives)
                    const emptyText =
                        sortedResults.length === 0 && group.search !== "searching" && !isFetchingPrimarySource
                            ? emptyGroupText(group.search)
                            : undefined;
                    return (
                        <Box
                            key={group.serviceKey}
                            flexDirection="column"
                            flexShrink={0}
                            marginTop={marginTop}
                            overflow="hidden"
                        >
                            <MetadataGroupHeader
                                group={group}
                                groupIndex={gIdx}
                                onSelect={onSelectCursor}
                                isSelected={cursor.type === "group" && cursor.groupIndex === gIdx}
                                isActive={isActive}
                                emptyText={emptyText}
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
                            {group.search === "searching" && (
                                <GroupSearchRow serviceKey={group.serviceKey} onSkip={onSkipSearch} />
                            )}
                        </Box>
                    );
                })}
                {(isFetchingPrimarySource || isDiscovering) && (
                    <Box flexDirection="row" height={1} marginTop={1} paddingLeft={3} flexShrink={0} overflow="hidden">
                        <Box flexDirection="row" paddingRight={1} flexShrink={0}>
                            <Text color={theme.text.secondary}>
                                <AnimatedIcon icon={Icon.Dots} interval={125} color={theme.text.secondary} />
                            </Text>
                        </Box>
                        <Text color={theme.text.secondary} wrap="truncate-end">
                            {getLoadingText(isFetchingPrimarySource, isDiscovering)}
                        </Text>
                        {canSkipDiscovery && <SkipButton onSkip={onSkipDiscovery} label={skipAllLabel} />}
                    </Box>
                )}
            </Box>
            {/* Optional, slow and costly: only on the user's request. Right under the last group; the list above
                gives way (clips) when the panel is full, so the button is never pushed out of sight. */}
            {!isFetchingPrimarySource &&
                !isDiscovering &&
                lastResortOffers.map((offer, i) => (
                    <Box key={offer.key} marginTop={i === 0 ? 1 : 0} paddingLeft={3} flexShrink={0} overflow="hidden">
                        <LastResortButton
                            serviceKey={offer.key}
                            missingText={offer.missing.map((p) => providerDisplayRegistry.get(p).label).join(", ")}
                            // The key asks the first service (or stops the one running): only that button shows it.
                            showKey={lastResortBusyKey ? lastResortBusyKey === offer.key : i === 0}
                            busy={lastResortBusyKey === offer.key}
                            onAsk={onAskLastResort}
                            onStop={onStopLastResort}
                        />
                    </Box>
                ))}
        </Box>
    );
};
