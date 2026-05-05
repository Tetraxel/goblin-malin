import React from "react";
import { Box, Text } from "ink";
import { TrackDownloadSource } from "../../../../flows/musicDownloadFlow/types";
import { formatBytes } from "../utils";
import { StateBadge } from "../StateBadge";

interface SourceFileRowProps {
  source: TrackDownloadSource;
  sourceIndex: number;
  isSelected: boolean;
  isActive: boolean;
  width: number;
}

export function SourceFileRow({
  source,
  sourceIndex,
  isSelected,
  isActive,
  width,
}: SourceFileRowProps) {
  const bg =
    isSelected && isActive ? "#2a2a2a" : isSelected ? "#131313" : undefined;

  const localFile = source.localFile;
  const filename = localFile ? `${localFile.name}.${localFile.extension}` : null;
  const sizeText = source.fileInfo ? formatBytes(source.fileInfo.sizeBytes) : "";

  return (
    <Box
      flexDirection="row"
      width={width}
      minWidth={width}
      height={1}
      overflow="hidden"
      backgroundColor={bg}
      paddingLeft={1}
    >
      <Box width={3} minWidth={3} flexShrink={0}>
        <Text color="cyan">{isSelected && isActive ? "☛ " : "  "}</Text>
      </Box>
      <Box width={2} minWidth={2} flexShrink={0}>
        {source.isRejected ? (
          <Text color="red">✘ </Text>
        ) : source.selected ? (
          <Text color="cyan">✓ </Text>
        ) : (
          <Text>{"  "}</Text>
        )}
      </Box>
      <Box minWidth={3} flexShrink={0}>
        <Text
          color="gray"
          dimColor={source.isRejected}
          strikethrough={source.isRejected}
        >
          {`${sourceIndex + 1}. `}
        </Text>
      </Box>
      <Box flexGrow={1} overflow="hidden">
        {filename ? (
          <Text
            color="white"
            wrap="truncate-end"
            dimColor={source.isRejected}
            strikethrough={source.isRejected}
          >
            {filename}
          </Text>
        ) : (
          <StateBadge source={source} />
        )}
      </Box>
      {sizeText !== "" && (
        <Box minWidth={sizeText.length + 1} paddingLeft={1} flexShrink={0}>
          <Text color="gray">{sizeText}</Text>
        </Box>
      )}
      <Box paddingLeft={1} paddingRight={1} flexShrink={0}>
        <StateBadge source={source} />
      </Box>
    </Box>
  );
}
