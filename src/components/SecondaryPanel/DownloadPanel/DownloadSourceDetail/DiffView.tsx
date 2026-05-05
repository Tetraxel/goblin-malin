import React from "react";
import { Box, Text } from "ink";
import { TrackDownloadSource } from "../../../../flows/musicDownloadFlow/types";
import { formatBytes, formatDuration, tagValue } from "../utils";
import { DiffRow } from "./DiffRow";

const DIFF_TAGS = ["TITLE", "ARTIST", "ALBUM", "DATE", "TRACKNUMBER"];

interface DiffViewProps {
  source: TrackDownloadSource;
  pendingSource: TrackDownloadSource;
  width: number;
  height: number;
}

export function DiffView({
  source,
  pendingSource,
  width,
  height,
}: DiffViewProps) {
  const curFile = source.localFile
    ? `${source.localFile.name}.${source.localFile.extension}`
    : "—";
  const newFile = pendingSource.localFile
    ? `${pendingSource.localFile.name}.${pendingSource.localFile.extension}`
    : "—";
  const curSize = source.fileInfo
    ? formatBytes(source.fileInfo.sizeBytes)
    : "—";
  const newSize = pendingSource.fileInfo
    ? formatBytes(pendingSource.fileInfo.sizeBytes)
    : "—";
  const curDur = formatDuration(
    source.fileInfo?.durationMs ?? source.track.duration,
  );
  const newDur = formatDuration(
    pendingSource.fileInfo?.durationMs ?? pendingSource.track.duration,
  );
  const curTags = source.fileInfo?.embeddedTags;
  const newTags = pendingSource.fileInfo?.embeddedTags;

  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      <Box flexDirection="row" paddingX={1}>
        <Text color="gray">┌── </Text>
        <Text color="yellow">Current (saved)</Text>
        <Text color="gray"> ───────────┬── </Text>
        <Text color="cyan">New</Text>
        <Text color="gray"> ──</Text>
      </Box>
      <Box
        flexDirection="column"
        flexGrow={1}
        overflow="hidden"
        borderStyle="single"
        borderColor="gray"
        borderTop={false}
      >
        <DiffRow label="File" left={curFile} right={newFile} />
        <DiffRow label="Size" left={curSize} right={newSize} />
        <DiffRow label="Duration" left={curDur} right={newDur} />
        <Box height={1} />
        {DIFF_TAGS.map((tag) => (
          <DiffRow
            key={tag}
            label={tag}
            left={tagValue(curTags, tag)}
            right={tagValue(newTags, tag)}
          />
        ))}
        <Box flexGrow={1} />
        <Box
          flexDirection="row"
          paddingX={1}
          height={1}
          overflow="hidden"
          flexShrink={0}
        >
          <Box marginRight={2}>
            <Text color="white" bold>
              [Enter]
            </Text>
            <Text color="gray"> Confirm switch</Text>
          </Box>
          <Box>
            <Text color="white" bold>
              [Esc]
            </Text>
            <Text color="gray"> Cancel</Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
