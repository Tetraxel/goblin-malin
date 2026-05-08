import React from "react";
import * as path from "path";
import { Box, Text } from "ink";
import { TrackDownloadSource } from "../../../../flows/musicDownloadFlow/types";
import { CompiledMetadata } from "../../../../flows/musicDownloadFlow/utils/compiledMetadata";
import {
  formatBytes,
  formatDuration,
  formatDate,
  getProviderColor,
} from "../utils";
import { DiffRow } from "./DiffRow";
import { Hint } from "../../../Hint";

interface DiffViewProps {
  savedSource: TrackDownloadSource;
  pendingSource: TrackDownloadSource;
  compiled: CompiledMetadata | null;
  outputDir: string;
  diffKind: "source-switch" | "metadata-change";
  isActive: boolean;
  width: number;
  height: number;
}

function computePreviewFilename(compiled: CompiledMetadata): string {
  const artist = compiled.artists[0]?.name ?? "Unknown Artist";
  const title = compiled.trackName || "Unknown Title";
  return `${artist} - ${title}.flac`.replace(/[/\\:*?"<>|]/g, "_");
}

export function DiffView({
  savedSource,
  pendingSource,
  compiled,
  outputDir,
  diffKind,
  isActive,
  width,
  height,
}: DiffViewProps) {
  // OLD — what is currently on disk
  const oldFilename = path.basename(savedSource.savedFile!.path);
  const oldDir = path.dirname(savedSource.savedFile!.path);
  const oldSize = savedSource.fileInfo
    ? formatBytes(savedSource.fileInfo.sizeBytes)
    : "—";
  const oldDuration = formatDuration(
    savedSource.fileInfo?.durationMs ?? savedSource.track.duration,
  );
  const oldSavedAt = formatDate(savedSource.savedFile!.savedAt);
  const oldProvider = savedSource.provider.toUpperCase();

  // NEW — what would be written after saving
  const newFilename = compiled ? computePreviewFilename(compiled) : oldFilename;
  const newDir = outputDir;
  const newSize = pendingSource.fileInfo
    ? formatBytes(pendingSource.fileInfo.sizeBytes)
    : "—";
  const newDuration = formatDuration(
    pendingSource.fileInfo?.durationMs ?? pendingSource.track.duration,
  );
  const newProvider = pendingSource.provider.toUpperCase();

  // Compiled metadata fields (same for both sides — diff appears if metadata
  // has changed since the save, which we don't snapshot yet)
  const title = compiled?.trackName || "—";
  const artists = compiled?.artists.map((a) => a.name).join(", ") || "—";
  const album = compiled?.album?.albumName || "—";
  const year = compiled?.year != null ? String(compiled.year) : "—";
  const bpm = compiled?.bpm != null ? String(compiled.bpm) : "—";
  const key = compiled?.key || "—";
  const genres = compiled?.genres?.join(", ") || "—";

  const innerW = width - 2;
  const oldProviderColor = getProviderColor(savedSource.provider);
  const newProviderColor = getProviderColor(pendingSource.provider);

  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      {/* Header */}
      <Box flexDirection="row" paddingX={1} height={1} flexShrink={0}>
        <Text color="gray">┌── </Text>
        <Text color={oldProviderColor as any}>{oldProvider}</Text>
        <Text color="gray"> → </Text>
        <Text color={newProviderColor as any}>{newProvider}</Text>
        <Text color="gray">
          {"─".repeat(
            Math.max(0, innerW - oldProvider.length - newProvider.length - 10),
          )}
          ┐
        </Text>
      </Box>

      <Box
        flexDirection="column"
        flexGrow={1}
        overflow="hidden"
        borderStyle="single"
        borderColor="gray"
        borderTop={false}
      >
        {/* File section */}
        <Box paddingX={1} height={1} flexShrink={0}>
          <Text color="gray">
            {"── File "}
            {"─".repeat(Math.max(0, innerW - 9))}
          </Text>
        </Box>
        <DiffRow label="Provider" left={oldProvider} right={newProvider} />
        <DiffRow label="Filename" left={oldFilename} right={newFilename} />
        <DiffRow label="Directory" left={oldDir} right={newDir} />
        <DiffRow label="Size" left={oldSize} right={newSize} />
        <DiffRow label="Duration" left={oldDuration} right={newDuration} />
        <DiffRow label="Saved" left={oldSavedAt} right="(new)" />

        {/* Metadata section */}
        <Box height={1} flexShrink={0} />
        <Box paddingX={1} height={1} flexShrink={0}>
          <Text color="gray">
            {"── Metadata "}
            {"─".repeat(Math.max(0, innerW - 13))}
          </Text>
        </Box>
        <DiffRow label="Title" left={title} right={title} />
        <DiffRow label="Artists" left={artists} right={artists} />
        <DiffRow label="Album" left={album} right={album} />
        <DiffRow label="Year" left={year} right={year} />
        <DiffRow label="BPM" left={bpm} right={bpm} />
        <DiffRow label="Key" left={key} right={key} />
        <DiffRow label="Genres" left={genres} right={genres} />

        <Box flexGrow={1} />

        {/* Hint bar */}
        <Box
          flexDirection="row"
          paddingX={1}
          height={1}
          overflow="hidden"
          flexShrink={0}
        >
          <Hint
            label={
              diffKind === "metadata-change" ? "Save changes" : "Switch source"
            }
            shortcut="Enter"
            dim={!isActive}
          />
          <Hint label="Cancel" shortcut="Esc" dim={!isActive} />
        </Box>
      </Box>
    </Box>
  );
}
