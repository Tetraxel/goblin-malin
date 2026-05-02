import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import {
  MetadataSourceState,
  MetadataOverrides,
} from "../../../flows/musicDownloadFlow/types";
import { CompiledMetadata } from "../../../flows/musicDownloadFlow/utils/compiledMetadata";
import { useSourceListInput } from "../../../hooks/useSourceListInput";
import { MetadataSourceRow } from "./MetadataSourceRow";
import { MetadataCompiledRow } from "./MetadataCompiledRow";

interface MetadataSourceListProps {
  sources: MetadataSourceState[];
  compiled: CompiledMetadata;
  overrides: MetadataOverrides;
  selectedIndex: number; // -1 = compiled row, 0+ = source index
  isActive: boolean;
  width: number;
  height: number;
  onSelectSource: (index: number) => void;
  onInnerFocusSwitch: () => void; // called when → is pressed to move to detail
  onSourcesChange: (sources: MetadataSourceState[]) => void;
  isDiscovering?: boolean;
}

const HEADER_LINE =
  "Top-ranked favorite sources are more likely to be used for downloading";

export const MetadataSourceList: React.FC<MetadataSourceListProps> = ({
  sources,
  compiled,
  overrides,
  selectedIndex,
  isActive,
  width,
  height,
  onSelectSource,
  onInnerFocusSwitch,
  onSourcesChange,
  isDiscovering = false,
}) => {
  const sortedSources = [...sources].sort((a, b) => a.rank - b.rank);

  useSourceListInput({
    sources,
    sortedSources,
    selectedIndex,
    isActive,
    onSelectSource,
    onInnerFocusSwitch,
    onSourcesChange,
  });

  const overrideCount = Object.keys(overrides).filter(
    (k) => overrides[k as keyof MetadataOverrides] !== undefined,
  ).length;

  // height - 1: one row for the header; minus 1 more when a spinner row is shown
  const maxSourceRows = height - 2 - (isDiscovering ? 1 : 0);
  const visibleSources = sortedSources.slice(0, maxSourceRows);

  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      <Text color="gray" italic wrap="truncate-end">
        {" " + HEADER_LINE}
      </Text>
      <Box flexDirection="row" height={1} overflow="hidden" />
      <Box flexDirection="column" overflow="hidden">
        <MetadataCompiledRow
          compiled={compiled}
          overrideCount={overrideCount}
          isSelected={selectedIndex === -1}
          isActive={isActive}
          width={width}
        />
        {visibleSources.map((source) => {
          const originalIndex = sources.indexOf(source);
          return (
            <MetadataSourceRow
              key={originalIndex}
              source={source}
              isSelected={selectedIndex === originalIndex}
              isActive={isActive}
              width={width}
            />
          );
        })}
      </Box>
      {isDiscovering && (
        <Box paddingLeft={3}>
          <Text color="gray">
            <Spinner type="dots" />
          </Text>
          <Text color="gray"> Discovering on other platforms…</Text>
        </Box>
      )}
    </Box>
  );
};
