import React from "react";
import { Box, Text, useInput } from "ink";
import {
  TrackDownloadSource,
  DownloadProvider,
} from "../../../../flows/musicDownloadFlow/types";
import { providerDisplayRegistry } from "../../../../base/providerDisplay";
import { getInstance } from "../../../../utils/mpvPlayer";
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

function buildTreeItems(sources: TrackDownloadSource[]): TreeItem[] {
  const items: TreeItem[] = [];
  const seenProviders = new Set<string>();
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
    }
    items.push({ type: "metadata-header", source, sourceIndex: i });
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
  onInnerFocusSwitch,
}) => {
  const treeItems = buildTreeItems(sources);
  const selectableIndices = treeItems
    .filter(
      (item): item is Extract<TreeItem, { type: "file-row" }> =>
        item.type === "file-row",
    )
    .map((item) => item.sourceIndex);

  useInput(
    (input, key) => {
      if (key.upArrow) {
        const pos = selectableIndices.indexOf(selectedSourceIndex);
        if (pos > 0) onSelectSource(selectableIndices[pos - 1]);
        return;
      }
      if (key.downArrow) {
        const pos = selectableIndices.indexOf(selectedSourceIndex);
        if (pos === -1 && selectableIndices.length > 0) {
          onSelectSource(selectableIndices[0]);
        } else if (pos < selectableIndices.length - 1) {
          onSelectSource(selectableIndices[pos + 1]);
        }
        return;
      }
      if (key.rightArrow && !key.shift) {
        onInnerFocusSwitch();
        return;
      }
      if (key.return && selectedSourceIndex >= 0) {
        onRequestSelect(selectedSourceIndex);
        return;
      }
      if (key.delete && selectedSourceIndex >= 0) {
        onRejectSource(selectedSourceIndex);
        return;
      }
      if (input === " " && !key.ctrl && !key.meta) {
        const source = sources[selectedSourceIndex];
        if (source?.localFile?.state !== "found") return;
        const filePath = source.localFile.path;
        const player = getInstance();
        const status = player.getStatus();
        if (
          status.filePath === filePath &&
          (status.isPlaying || status.isPaused)
        ) {
          player.togglePause().catch(() => {});
        } else {
          player.play(filePath).catch(() => {});
        }
        return;
      }
    },
    { isActive },
  );

  if (sources.length === 0) {
    return (
      <Box
        flexDirection="column"
        width={width}
        height={height}
        overflow="hidden"
        paddingX={1}
        paddingY={1}
      >
        <Text color="gray" dimColor>
          No download sources yet
        </Text>
      </Box>
    );
  }

  let groupBreak = false;
  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      {treeItems.map((item, i) => {
        if (item.type === "provider-header") {
          const addMargin = groupBreak;
          groupBreak = true;
          return (
            <ProviderHeader
              key={`ph-${i}`}
              label={item.label}
              color={item.color}
              addMargin={addMargin}
            />
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
