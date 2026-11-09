import React, { useRef, useState } from "react";
import { Box, Text, type DOMElement } from "ink";
import { useWheelTarget } from "#base/mouse/useMouseTarget";
import { useTheme } from "#base/themeContext";
import { providerDisplayRegistry } from "#base/providerDisplay";
import { TrackDownloadSource, DownloadProvider, DownloadQueryField } from "#flows/musicDownloadFlow/types";
import type { Updater } from "#hooks/useFocusManager";
import { togglePlayback } from "#utils/togglePlayback";
import { playableFilePath } from "#flows/musicDownloadFlow/utils/playableFile";
import { useShortcuts } from "#hooks/useShortcuts";
import { useNowPlaying, type NowPlaying } from "#hooks/useNowPlaying";
import { ProviderHeader } from "./ProviderHeader";
import { MetadataHeader } from "./MetadataHeader";
import { SourceFileRow } from "./SourceFileRow";
import { QueryLines } from "./QueryLines";
import { MoreRow } from "./MoreRow";
import { SavedFileRow, SAVED_ROW_HEIGHT } from "./SavedFileRow";
import { computeWindow } from "./treeWindow";

interface DownloadSourceTreeProps {
    sources: TrackDownloadSource[];
    /** Show, under each group of rows, what the provider was actually asked for. */
    showQuery: boolean;
    selectedSourceIndex: number;
    /** The provider whose header holds the cursor (instead of one of its rows); null when a row does. */
    focusedProvider: DownloadProvider | null;
    /** The cursor is on the pinned "saved file" row (instead of the saved source's own row in the list). */
    savedFocused: boolean;
    isActive: boolean;
    width: number;
    height: number;
    onSelectSource: (index: number) => void;
    /** Put the cursor on a provider's header. */
    onFocusProvider: (provider: DownloadProvider) => void;
    /** Put the cursor on the pinned saved-file row. */
    onFocusSaved: () => void;
    /** Whether results a provider found but didn't list can be listed now (not while a download is running). */
    canShowMore: boolean;
    /** List the next results of the search whose listing ends at that row. */
    onShowMore: (anchorIndex: number) => void;
    /** Whether that provider's whole search + download can be re-run right now. */
    canRetryProvider: (provider: DownloadProvider) => boolean;
    /** Re-run that provider's search + download from scratch. */
    onRetryProvider: (provider: DownloadProvider) => void;
    /** A row was clicked: focus the list and select that source. */
    onClickSource: (index: number) => void;
    /** Mouse-wheel: move the selection without moving keyboard focus. */
    onScrollSource: (index: Updater<number>) => void;
    onRequestSelect: (index: number) => void;
    onRejectSource: (index: number) => void;
    onRetrySource: (index: number) => void;
    /** Save (or update) the file of that source to the output folder. */
    onRequestSave: (index: number) => void;
    onInnerFocusSwitch: () => void;
}

type TreeItem =
    | {
          type: "provider-header";
          provider: DownloadProvider;
          label: string;
          color: string;
      }
    | {
          type: "metadata-header";
          source: TrackDownloadSource;
          sourceIndex: number;
      }
    | { type: "query-lines"; query: DownloadQueryField[] }
    | { type: "file-row"; source: TrackDownloadSource; sourceIndex: number }
    /** Under the last row of one search that has results left unlisted: `firstIndex`..`anchorIndex` are that search's rows. */
    | { type: "more-row"; anchorIndex: number; firstIndex: number; count: number };

/** A place the cursor can be: the pinned saved file, a provider's header, or one download row. */
type NavTarget =
    { kind: "saved" } | { kind: "provider"; provider: DownloadProvider } | { kind: "source"; index: number };

function getProviderDisplay(provider: string): {
    label: string;
    color: string;
} {
    const display = providerDisplayRegistry.get(provider);
    return { label: display.acronym, color: display.color };
}

function metadataKeyOf(source: TrackDownloadSource): string {
    const m = source.track;
    return m.uri ?? `${m.platform}::${m.id}`;
}

function buildTreeItems(sources: TrackDownloadSource[], showQuery: boolean, canShowMore: boolean): TreeItem[] {
    const items: TreeItem[] = [];
    // The rows of one search (same provider, same query) — what a "more" row belongs to.
    let runKey: string | undefined;
    let runStart = 0;
    const seenProviders = new Set<string>();
    // Consecutive sources under the same provider that used the identical metadata
    // (the common case — one search/lookup feeds every candidate row) share a single
    // "used …" header instead of repeating it before every row.
    let lastMetadataKey: string | undefined;
    // Same idea for the query: rows found by one search share one set of query lines, and a
    // new set appears only where the query changes (e.g. Soulseek's MP3 search after its FLAC one).
    let lastQueryKey: string | undefined;
    sources.forEach((source, i) => {
        if (!seenProviders.has(source.provider)) {
            seenProviders.add(source.provider);
            const { label, color } = getProviderDisplay(source.provider);
            items.push({
                type: "provider-header",
                provider: source.provider,
                label,
                color,
            });
            lastMetadataKey = undefined;
            lastQueryKey = undefined;
        }
        const metadataKey = metadataKeyOf(source);
        if (metadataKey !== lastMetadataKey) {
            items.push({ type: "metadata-header", source, sourceIndex: i });
            lastMetadataKey = metadataKey;
        }
        if (showQuery && source.query && source.query.length > 0) {
            const queryKey = JSON.stringify(source.query);
            if (queryKey !== lastQueryKey) {
                items.push({ type: "query-lines", query: source.query });
                lastQueryKey = queryKey;
            }
        }
        const key = `${source.provider}|${JSON.stringify(source.query ?? null)}`;
        if (key !== runKey) {
            runKey = key;
            runStart = i;
        }
        items.push({ type: "file-row", source, sourceIndex: i });
        // Not while a row is still being worked on: listing more shifts the rows that are.
        if (canShowMore && source.moreCandidates && source.moreCandidates.length > 0) {
            items.push({ type: "more-row", anchorIndex: i, firstIndex: runStart, count: source.moreCandidates.length });
        }
    });
    return items;
}

/** How many terminal lines a tree item takes (a provider header after the first carries a blank line above it). */
function itemHeight(item: TreeItem, index: number, items: TreeItem[]): number {
    switch (item.type) {
        case "provider-header":
            return items.slice(0, index).some((t) => t.type === "provider-header") ? 2 : 1;
        case "query-lines":
            return item.query.length;
        default:
            return 1;
    }
}

/** Lines that head the rows under them: the provider header, the "used …" line, the query lines. */
function isRowContext(item: TreeItem): boolean {
    return item.type === "provider-header" || item.type === "metadata-header" || item.type === "query-lines";
}

/** Whether the player is on this source's file (the downloaded one, or the copy saved from it). */
function playbackOf(source: TrackDownloadSource, nowPlaying: NowPlaying): "playing" | "paused" | undefined {
    if (!nowPlaying) return undefined;
    const isThis = nowPlaying.filePath === source.localFile?.path || nowPlaying.filePath === source.savedFile?.path;
    if (!isThis) return undefined;
    return nowPlaying.isPaused ? "paused" : "playing";
}

export const DownloadSourceTree: React.FC<DownloadSourceTreeProps> = ({
    sources,
    showQuery,
    selectedSourceIndex,
    focusedProvider,
    savedFocused,
    isActive,
    width,
    height: fullHeight,
    onSelectSource,
    onFocusProvider,
    onFocusSaved,
    canShowMore,
    onShowMore,
    canRetryProvider,
    onRetryProvider,
    onClickSource,
    onScrollSource,
    onRequestSelect,
    onRejectSource,
    onRetrySource,
    onRequestSave,
    onInnerFocusSwitch,
}) => {
    const theme = useTheme();
    // Re-renders only when the track or its paused state changes, not on playback progress.
    const nowPlaying = useNowPlaying();
    // The saved file is pinned above the scrolling list, so the list gets what is left.
    const savedIndex = sources.findIndex((s) => s.savedFile != null);
    const hasSaved = savedIndex >= 0;
    const onSaved = hasSaved && savedFocused && focusedProvider === null;
    const height = hasSaved ? Math.max(1, fullHeight - SAVED_ROW_HEIGHT) : fullHeight;
    const treeItems = buildTreeItems(sources, showQuery, canShowMore);
    const selectableIndices = treeItems
        .filter((item): item is Extract<TreeItem, { type: "file-row" }> => item.type === "file-row")
        .map((item) => item.sourceIndex);

    const treeRef = useRef<DOMElement>(null);

    // The list can be taller than the panel (a search can list dozens of results): draw only the part
    // around the cursor, scrolling as little as needed, instead of letting the layout squeeze rows away.
    const [scrollStart, setScrollStart] = useState(0);
    // On the pinned row nothing in the list is focused: the window stays where it was.
    const focusedRowIndex = onSaved
        ? Math.min(scrollStart, Math.max(0, treeItems.length - 1))
        : Math.max(
              0,
              treeItems.findIndex((item) =>
                  focusedProvider !== null
                      ? item.type === "provider-header" && item.provider === focusedProvider
                      : item.type === "file-row" && item.sourceIndex === selectedSourceIndex
              )
          );
    // The "show more" row hangs off the row above it: keep it in view together with that row.
    const focusItemIndex = treeItems[focusedRowIndex + 1]?.type === "more-row" ? focusedRowIndex + 1 : focusedRowIndex;
    // The provider header, "used …" line and query lines right above a row belong with it: scrolling back
    // up to the first row of a group shows them too, so the top of the list is reachable again.
    let contextIndex = focusedRowIndex;
    while (!onSaved && contextIndex > 0 && isRowContext(treeItems[contextIndex - 1])) contextIndex--;
    const { start: windowStart, end: windowEnd } = computeWindow(
        treeItems.map((item, i) => itemHeight(item, i, treeItems)),
        focusItemIndex,
        scrollStart,
        height,
        contextIndex
    );
    if (windowStart !== scrollStart) setScrollStart(windowStart);
    useWheelTarget(treeRef, (delta) =>
        onScrollSource((prev) => {
            const pos = selectableIndices.indexOf(prev);
            if (pos === -1) return selectableIndices[0] ?? prev;
            return selectableIndices[Math.max(0, Math.min(selectableIndices.length - 1, pos + delta))];
        })
    );

    // Everything the cursor can land on, top to bottom: the pinned saved file, then each provider's header and its rows.
    const navTargets: NavTarget[] = [
        ...(hasSaved ? [{ kind: "saved" } as const] : []),
        ...treeItems.flatMap<NavTarget>((item) =>
            item.type === "provider-header"
                ? [{ kind: "provider", provider: item.provider }]
                : item.type === "file-row"
                  ? [{ kind: "source", index: item.sourceIndex }]
                  : []
        ),
    ];
    const navPos = navTargets.findIndex((t) =>
        onSaved
            ? t.kind === "saved"
            : focusedProvider !== null
              ? t.kind === "provider" && t.provider === focusedProvider
              : t.kind === "source" && t.index === selectedSourceIndex
    );
    const moveTo = (target: NavTarget | undefined) => {
        if (!target) return;
        if (target.kind === "saved") onFocusSaved();
        else if (target.kind === "provider") onFocusProvider(target.provider);
        else onSelectSource(target.index);
    };

    // While a header holds the cursor there is no row to select, play, save…
    const onHeader = focusedProvider !== null;
    const selectedSource = onHeader ? undefined : sources[selectedSourceIndex];
    const canRetryHeader = onHeader && canRetryProvider(focusedProvider);
    // Previewing and saving need a file: the temporary copy, or the saved file once that copy is cleaned up.
    const playPath = selectedSource ? playableFilePath(selectedSource) : null;
    const canPlay = playPath !== null;
    const saveLabel = selectedSource?.savedFile ? "Update" : "Save";
    // A source only carries retryPayload if its provider supports re-attempting it
    // on demand (e.g. a Soulseek candidate that was "skipped" or "failed") — gate on
    // the data being present rather than hardcoding which providers/states qualify.
    const canRetry =
        selectedSource?.retryPayload != null &&
        (selectedSource.state === "skipped" || selectedSource.state === "failed");
    // The "more" row of the search the cursor is in, if it has one.
    const moreItem =
        onHeader || onSaved
            ? undefined
            : treeItems.find(
                  (item): item is Extract<TreeItem, { type: "more-row" }> =>
                      item.type === "more-row" &&
                      selectedSourceIndex >= item.firstIndex &&
                      selectedSourceIndex <= item.anchorIndex
              );

    useShortcuts({
        id: "downloadSourceTree",
        isActive,
        priority: 150,
        shortcuts: [
            {
                id: "downloadSourceTree.up",
                defaultShortcut: { key: "upArrow" },
                label: "Up",
                handler: () => {
                    if (navPos > 0) moveTo(navTargets[navPos - 1]);
                },
            },
            {
                id: "downloadSourceTree.down",
                defaultShortcut: { key: "downArrow" },
                label: "Down",
                handler: () => {
                    if (navPos === -1) moveTo(navTargets[0]);
                    else if (navPos < navTargets.length - 1) moveTo(navTargets[navPos + 1]);
                },
            },
            {
                id: "downloadSourceTree.focusDetail",
                defaultShortcut: { key: "rightArrow" },
                label: "Details",
                handler: () => {
                    // A header has no detail of its own to step into.
                    if (!onHeader) onInnerFocusSwitch();
                },
            },
            {
                id: "downloadSourceTree.select",
                defaultShortcut: { key: "return" },
                label: "Select",
                handler: () => {
                    if (!onHeader && selectedSourceIndex >= 0) onRequestSelect(selectedSourceIndex);
                },
            },
            {
                id: "downloadSourceTree.reject",
                defaultShortcut: { key: "delete" },
                label: "Reject",
                handler: () => {
                    // The saved file is not rejected by accident from its pinned row.
                    if (!onHeader && !onSaved && selectedSourceIndex >= 0) onRejectSource(selectedSourceIndex);
                },
            },
            {
                id: "downloadSourceTree.save",
                defaultShortcut: { input: "s" },
                label: saveLabel,
                handler: () => {
                    if (canPlay) onRequestSave(selectedSourceIndex);
                },
            },
            {
                id: "downloadSourceTree.retry",
                defaultShortcut: { input: "w" },
                label: "Download",
                handler: () => {
                    if (canRetry) onRetrySource(selectedSourceIndex);
                },
            },
            {
                id: "downloadSourceTree.showMore",
                defaultShortcut: { input: "m" },
                label: "Show more",
                handler: () => {
                    if (moreItem) onShowMore(moreItem.anchorIndex);
                },
            },
            {
                id: "downloadSourceTree.retryProvider",
                defaultShortcut: { input: "r" },
                label: "Retry",
                handler: () => {
                    if (canRetryHeader) onRetryProvider(focusedProvider);
                },
            },
            {
                id: "downloadSourceTree.playPause",
                defaultShortcut: { input: " " },
                label: "Play/Pause",
                handler: () => {
                    if (playPath === null) return;
                    togglePlayback(playPath);
                },
            },
        ],
        hintLines: [
            {
                id: "downloadSourceTree.line.sources",
                left: onHeader
                    ? { type: "text" as const, value: getProviderDisplay(focusedProvider).label, bold: true }
                    : onSaved
                      ? { type: "text" as const, value: "Saved file", bold: true }
                      : selectedSourceIndex >= 0 && sources.length > 0
                        ? {
                              type: "text" as const,
                              value: `Source ${selectedSourceIndex + 1}/${sources.length}`,
                              bold: true,
                          }
                        : { type: "text" as const, value: "Download Sources", bold: true },
                shortcutIds: [
                    ...(onHeader || onSaved ? [] : ["downloadSourceTree.select", "downloadSourceTree.reject"]),
                    ...(canRetryHeader ? ["downloadSourceTree.retryProvider"] : []),
                    ...(canRetry ? ["downloadSourceTree.retry"] : []),
                    ...(moreItem ? ["downloadSourceTree.showMore"] : []),
                    ...(canPlay ? ["downloadSourceTree.playPause", "downloadSourceTree.save"] : []),
                ],
            },
        ],
    });

    if (sources.length === 0) {
        return (
            <Box
                ref={treeRef}
                flexDirection="column"
                width={width}
                height={height}
                overflow="hidden"
                paddingX={1}
                paddingY={1}
            >
                <Text color={theme.text.secondary} dimColor>
                    No download sources yet
                </Text>
            </Box>
        );
    }

    return (
        <Box ref={treeRef} flexDirection="column" width={width} height={fullHeight} overflow="hidden">
            {hasSaved && (
                <SavedFileRow
                    source={sources[savedIndex]}
                    isFocused={onSaved}
                    isActive={isActive}
                    width={width}
                    playback={playbackOf(sources[savedIndex], nowPlaying)}
                    onSelect={onFocusSaved}
                />
            )}
            {treeItems.slice(windowStart, windowEnd).map((item, offset) => {
                const i = windowStart + offset;
                if (item.type === "provider-header") {
                    const addMargin = treeItems.slice(0, i).some((t) => t.type === "provider-header");
                    return (
                        <ProviderHeader
                            key={`ph-${i}`}
                            label={item.label}
                            color={item.color}
                            addMargin={addMargin}
                            width={width}
                            isFocused={item.provider === focusedProvider}
                            isActive={isActive}
                            onSelect={() => onFocusProvider(item.provider)}
                        />
                    );
                }

                if (item.type === "metadata-header") {
                    return <MetadataHeader key={`mh-${i}`} source={item.source} />;
                }

                if (item.type === "query-lines") {
                    return <QueryLines key={`ql-${i}`} query={item.query} />;
                }

                if (item.type === "more-row") {
                    return (
                        <MoreRow
                            key={`mr-${i}`}
                            count={item.count}
                            isFocused={
                                isActive &&
                                !onHeader &&
                                !onSaved &&
                                selectedSourceIndex >= item.firstIndex &&
                                selectedSourceIndex <= item.anchorIndex
                            }
                            width={width}
                            onShowMore={() => onShowMore(item.anchorIndex)}
                        />
                    );
                }

                return (
                    <SourceFileRow
                        key={`fr-${i}`}
                        source={item.source}
                        sourceIndex={item.sourceIndex}
                        isSelected={!onHeader && !onSaved && item.sourceIndex === selectedSourceIndex}
                        isActive={isActive}
                        width={width}
                        playback={playbackOf(item.source, nowPlaying)}
                        onSelect={onClickSource}
                    />
                );
            })}
        </Box>
    );
};
