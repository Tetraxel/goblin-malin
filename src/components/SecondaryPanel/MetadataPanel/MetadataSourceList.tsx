import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import {
  MetadataSourceState,
  MetadataOverrides,
} from "../../../flows/musicDownloadFlow/types";
import { CompiledMetadata } from "../../../flows/musicDownloadFlow/utils/compiledMetadata";
import { useSourceListInput } from "./useSourceListInput";
import { MetadataSourceRow } from "./MetadataSourceRow";
import { MetadataCompiledRow } from "./MetadataCompiledRow";
import { useTheme } from "../../../base/themeContext";

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
  isFetchingPrimarySource?: boolean;
  isDiscovering?: boolean;
}

const HEADER_LINE =
  "Top-ranked favorite sources are more likely to be used for downloading";

const getLoadingText = (
  isFetchingPrimarySource: boolean,
  isDiscovering: boolean,
) => {
  if (isFetchingPrimarySource) return "Fetching primary source…";
  if (isDiscovering) return "Discovering on other platforms…";
  return "";
};

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
  isFetchingPrimarySource = false,
  isDiscovering = false,
}) => {
  const theme = useTheme();
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
      <Box flexDirection="row" height={1} overflow="hidden">
        <Text color="gray" italic wrap="truncate-end">
          {" " + HEADER_LINE}
        </Text>
      </Box>
      <Box flexDirection="row" height={1} overflow="hidden" />
      <Box flexDirection="row">
        <MetadataCompiledRow
          compiled={compiled}
          overrideCount={overrideCount}
          isSelected={selectedIndex === -1}
          isActive={isActive}
          width={width}
        />
      </Box>
      <Box flexDirection="row" overflow="hidden">
        <Box flexDirection="column" overflow="hidden">
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
      </Box>
      {(isFetchingPrimarySource || isDiscovering) && (
        <Box flexDirection="row" height={1} paddingLeft={3} flexShrink={0}>
          <Box flexDirection="row" paddingRight={1} flexShrink={0}>
            <Text color={theme.text.secondary}>
              <Spinner type="dots" />
            </Text>
          </Box>
          <Box flexDirection="row" flexShrink={0}>
            <Text color={theme.text.secondary}>
              {getLoadingText(isFetchingPrimarySource, isDiscovering)}
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  );
};
