import React from "react";
import { Box, Text } from "ink";
import { CompiledMetadata } from "../../../flows/musicDownloadFlow/utils/compiledMetadata";

const COMPILED_PREFIX = "🏆 Compiled Metadata: ";

interface CompiledRowProps {
  compiled: CompiledMetadata;
  overrideCount: number;
  isSelected: boolean;
  isActive: boolean;
  width: number;
}

export const MetadataCompiledRow: React.FC<CompiledRowProps> = ({
  compiled,
  overrideCount,
  isSelected,
  isActive,
  width,
}) => {
  const focusColorBg = isActive ? "#2a2a2a" : "#131313";
  const bg = isSelected ? focusColorBg : undefined;
  const artist = compiled.artists[0]?.name ?? "";
  const title = compiled.trackName ?? "";
  const trackInfo = artist ? `${artist} - ${title}` : title;
  const suffixText =
    overrideCount > 0
      ? ` (${overrideCount} edit${overrideCount === 1 ? "" : "s"})`
      : "";

  return (
    <Box
      flexDirection="row"
      flexGrow={1}
      width={width}
      minWidth={width}
      overflow="hidden"
      backgroundColor={bg}
    >
      <Box width={3} minWidth={3}>
        <Text color={isSelected && isActive ? "white" : "gray"}>
          {isSelected && isActive ? "☛ " : "  "}
        </Text>
      </Box>
      <Box width={COMPILED_PREFIX.length} minWidth={COMPILED_PREFIX.length}>
        <Text color="yellow">{COMPILED_PREFIX}</Text>
      </Box>
      <Box flexGrow={1} flexDirection="row">
        <Text color="white" wrap="truncate-end">
          {trackInfo}
        </Text>
      </Box>
      {overrideCount > 0 && (
        <Box flexShrink={0}>
          <Text color="gray" italic wrap="truncate-end">
            {suffixText}
          </Text>
        </Box>
      )}
      {isSelected && (
        <Box
          flexDirection="row"
          height={1}
          width={5}
          minWidth={5}
          paddingLeft={1}
          paddingRight={1}
        >
          <Text color="gray">{">>>"}</Text>
        </Box>
      )}
    </Box>
  );
};
