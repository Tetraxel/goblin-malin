import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "#base/themeContext";
import { providerDisplayRegistry } from "#base/providerDisplay";
import { TrackDownloadSource, DownloadProvider } from "#flows/musicDownloadFlow/types";
import { getInstance } from "#utils/mpvPlayer";
import { useShortcuts } from "#hooks/useShortcuts";
import { ProviderHeader } from "./ProviderHeader";
import { MetadataHeader } from "./MetadataHeader";
import { SourceFileRow } from "./SourceFileRow";

interface DownloadSourceTreeProps {
    sources: TrackDownloadSource[];
    selectedSourceIndex: number;
    isActive: boolean;
    width: number;
    height: number;
    onSelectSource: (index: number) => void;
    onRequestSelect: (index: number) => void;
    onRejectSource: (index: number) => void;
    onRetrySource: (index: number) => void;
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

function buildTreeItems(sources: TrackDownloadSource[]): TreeItem[] {
    const items: TreeItem[] = [];
    const seenProviders = new Set<string>();
    // Consecutive sources under the same provider that used the identical metadata
    // (the common case — one search/lookup feeds every candidate row) share a single
    // "used …" header instead of repeating it before every row.
    let lastMetadataKey: string | undefined;
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
        }
        const metadataKey = metadataKeyOf(source);
        if (metadataKey !== lastMetadataKey) {
            items.push({ type: "metadata-header", source, sourceIndex: i });
            lastMetadataKey = metadataKey;
        }
        items.push({ type: "file-row", source, sourceIndex: i });
    });
    return items;
}

export const DownloadSourceTree: React.FC<DownloadSourceTreeProps> = ({
    sources,
    selectedSourceIndex,
    isActive,
    width,
    height,
    onSelectSource,
    onRequestSelect,
    onRejectSource,
    onRetrySource,
    onInnerFocusSwitch,
}) => {
    const theme = useTheme();
    const treeItems = buildTreeItems(sources);
    const selectableIndices = treeItems
        .filter((item): item is Extract<TreeItem, { type: "file-row" }> => item.type === "file-row")
        .map((item) => item.sourceIndex);

    const selectedSource = sources[selectedSourceIndex];
    const canPlay = selectedSource?.localFile?.state === "found";
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
                    const filePath = source.localFile.path;
                    const player = getInstance();
                    const status = player.getStatus();
                    if (status.filePath === filePath && (status.isPlaying || status.isPaused)) {
                        player.togglePause().catch(() => {});
                    } else {
                        player.play(filePath).catch(() => {});
                    }
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
                    ...(canPlay ? ["downloadSourceTree.playPause"] : []),
                ],
            },
        ],
    });

    if (sources.length === 0) {
        return (
            <Box flexDirection="column" width={width} height={height} overflow="hidden" paddingX={1} paddingY={1}>
                <Text color={theme.text.secondary} dimColor>
                    No download sources yet
                </Text>
            </Box>
        );
    }

    return (
        <Box flexDirection="column" width={width} height={height} overflow="hidden">
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

                return (
                    <SourceFileRow
                        key={`fr-${i}`}
                        source={item.source}
                        sourceIndex={item.sourceIndex}
                        isSelected={item.sourceIndex === selectedSourceIndex}
                        isActive={isActive}
                        width={width}
                    />
                );
            })}
        </Box>
    );
};
