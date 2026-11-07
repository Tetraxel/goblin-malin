import React, { useRef } from "react";
import { Box, Text, type DOMElement } from "ink";
import { useWheelTarget } from "#base/mouse/useMouseTarget";
import { useTheme } from "#base/themeContext";
import { providerDisplayRegistry } from "#base/providerDisplay";
import { TrackDownloadSource, DownloadProvider, DownloadQueryField } from "#flows/musicDownloadFlow/types";
import type { Updater } from "#hooks/useFocusManager";
import { togglePlayback } from "#utils/togglePlayback";
import { useShortcuts } from "#hooks/useShortcuts";
import { useNowPlaying, type NowPlaying } from "#hooks/useNowPlaying";
import { ProviderHeader } from "./ProviderHeader";
import { MetadataHeader } from "./MetadataHeader";
import { SourceFileRow } from "./SourceFileRow";
import { QueryLines } from "./QueryLines";

interface DownloadSourceTreeProps {
    sources: TrackDownloadSource[];
    /** Show, under each group of rows, what the provider was actually asked for. */
    showQuery: boolean;
    selectedSourceIndex: number;
    isActive: boolean;
    width: number;
    height: number;
    onSelectSource: (index: number) => void;
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
    | { type: "file-row"; source: TrackDownloadSource; sourceIndex: number };

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

function buildTreeItems(sources: TrackDownloadSource[], showQuery: boolean): TreeItem[] {
    const items: TreeItem[] = [];
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
        items.push({ type: "file-row", source, sourceIndex: i });
    });
    return items;
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
    isActive,
    width,
    height,
    onSelectSource,
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
    const treeItems = buildTreeItems(sources, showQuery);
    const selectableIndices = treeItems
        .filter((item): item is Extract<TreeItem, { type: "file-row" }> => item.type === "file-row")
        .map((item) => item.sourceIndex);

    const treeRef = useRef<DOMElement>(null);
    useWheelTarget(treeRef, (delta) =>
        onScrollSource((prev) => {
            const pos = selectableIndices.indexOf(prev);
            if (pos === -1) return selectableIndices[0] ?? prev;
            return selectableIndices[Math.max(0, Math.min(selectableIndices.length - 1, pos + delta))];
        })
    );

    const selectedSource = sources[selectedSourceIndex];
    const canPlay = selectedSource?.localFile?.state === "found";
    const saveLabel = selectedSource?.savedFile ? "Update" : "Save";
    // A source only carries retryPayload if its provider supports re-attempting it
    // on demand (e.g. a Soulseek candidate that was "skipped" or "failed") — gate on
    // the data being present rather than hardcoding which providers/states qualify.
    const canRetry =
        selectedSource?.retryPayload != null &&
        (selectedSource.state === "skipped" || selectedSource.state === "failed");

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
                    const pos = selectableIndices.indexOf(selectedSourceIndex);
                    if (pos > 0) onSelectSource(selectableIndices[pos - 1]);
                },
            },
            {
                id: "downloadSourceTree.down",
                defaultShortcut: { key: "downArrow" },
                label: "Down",
                handler: () => {
                    const pos = selectableIndices.indexOf(selectedSourceIndex);
                    if (pos === -1 && selectableIndices.length > 0) {
                        onSelectSource(selectableIndices[0]);
                    } else if (pos < selectableIndices.length - 1) {
                        onSelectSource(selectableIndices[pos + 1]);
                    }
                },
            },
            {
                id: "downloadSourceTree.focusDetail",
                defaultShortcut: { key: "rightArrow" },
                label: "Details",
                handler: () => onInnerFocusSwitch(),
            },
            {
                id: "downloadSourceTree.select",
                defaultShortcut: { key: "return" },
                label: "Select",
                handler: () => {
                    if (selectedSourceIndex >= 0) onRequestSelect(selectedSourceIndex);
                },
            },
            {
                id: "downloadSourceTree.reject",
                defaultShortcut: { key: "delete" },
                label: "Reject",
                handler: () => {
                    if (selectedSourceIndex >= 0) onRejectSource(selectedSourceIndex);
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
                id: "downloadSourceTree.playPause",
                defaultShortcut: { input: " " },
                label: "Play/Pause",
                handler: () => {
                    if (!canPlay) return;
                    const source = sources[selectedSourceIndex];
                    if (!source?.localFile?.path) return;
                    togglePlayback(source.localFile.path);
                },
            },
        ],
        hintLines: [
            {
                id: "downloadSourceTree.line.sources",
                left:
                    selectedSourceIndex >= 0 && sources.length > 0
                        ? {
                              type: "text" as const,
                              value: `Source ${selectedSourceIndex + 1}/${sources.length}`,
                              bold: true,
                          }
                        : { type: "text" as const, value: "Download Sources", bold: true },
                shortcutIds: [
                    "downloadSourceTree.select",
                    "downloadSourceTree.reject",
                    ...(canRetry ? ["downloadSourceTree.retry"] : []),
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
        <Box ref={treeRef} flexDirection="column" width={width} height={height} overflow="hidden">
            {treeItems.map((item, i) => {
                if (item.type === "provider-header") {
                    const addMargin = treeItems.slice(0, i).some((t) => t.type === "provider-header");
                    return (
                        <ProviderHeader key={`ph-${i}`} label={item.label} color={item.color} addMargin={addMargin} />
                    );
                }

                if (item.type === "metadata-header") {
                    return <MetadataHeader key={`mh-${i}`} source={item.source} />;
                }

                if (item.type === "query-lines") {
                    return <QueryLines key={`ql-${i}`} query={item.query} />;
                }

                return (
                    <SourceFileRow
                        key={`fr-${i}`}
                        source={item.source}
                        sourceIndex={item.sourceIndex}
                        isSelected={item.sourceIndex === selectedSourceIndex}
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
