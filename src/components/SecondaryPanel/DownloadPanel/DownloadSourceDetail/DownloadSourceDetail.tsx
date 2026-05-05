import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { TrackDownloadSource } from "../../../../flows/musicDownloadFlow/types";
import { getInstance, PlayerStatus } from "../../../../utils/mpvPlayer";
import {
  getProviderColor,
  formatBytes,
  formatDuration,
  formatDate,
  tagValue,
} from "../utils";
import { PlaybackBar } from "../PlaybackBar";
import { DiffView } from "./DiffView";
import { DetailRow } from "./DetailRow";
import { Hint } from "../../../Hint";

interface DownloadSourceDetailProps {
  source: TrackDownloadSource | null;
  isDiffMode: boolean;
  pendingSource: TrackDownloadSource | null;
  isActive: boolean;
  width: number;
  height: number;
  onInnerFocusSwitch: () => void;
  onConfirmDiff: () => void;
  onCancelDiff: () => void;
  onRelocateFile: () => void;
}

const PRIORITY_TAGS = [
  "TITLE",
  "ARTIST",
  "ALBUM",
  "DATE",
  "TRACKNUMBER",
  "ISRC",
  "BPM",
  "KEY",
];

function SectionDivider({ label, width }: { label: string; width: number }) {
  const innerW = width - 2;
  const dashes = Math.max(0, innerW - label.length - 3);
  return (
    <Box paddingX={1} height={1} flexDirection="column">
      <Text color="gray">
        {"── "}
        {label}
        {" " + "─".repeat(dashes)}
      </Text>
    </Box>
  );
}

export const DownloadSourceDetail: React.FC<DownloadSourceDetailProps> = ({
  source,
  isDiffMode,
  pendingSource,
  isActive,
  width,
  height,
  onInnerFocusSwitch,
  onConfirmDiff,
  onCancelDiff,
  onRelocateFile,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);

  const currentFilePath = source?.localFile?.path ?? null;

  useEffect(() => {
    const player = getInstance();

    function syncFromStatus(status: PlayerStatus) {
      const isThisFile = status.filePath === currentFilePath;
      setIsPlaying(isThisFile && status.isPlaying);
      setIsPaused(isThisFile && status.isPaused);
      if (isThisFile) {
        setPositionMs(status.positionMs);
        setDurationMs(status.durationMs);
      } else {
        setPositionMs(0);
        setDurationMs(0);
      }
    }

    const onProgress = (pos: number, dur: number) => {
      if (player.getStatus().filePath === currentFilePath) {
        setPositionMs(pos);
        setDurationMs(dur);
      }
    };
    const onStateChange = (status: PlayerStatus) => syncFromStatus(status);
    const onEnded = () => {
      setIsPlaying(false);
      setIsPaused(false);
      setPositionMs(0);
    };

    player.on("progress", onProgress);
    player.on("stateChange", onStateChange);
    player.on("ended", onEnded);
    syncFromStatus(player.getStatus());

    return () => {
      player.off("progress", onProgress);
      player.off("stateChange", onStateChange);
      player.off("ended", onEnded);
    };
  }, [currentFilePath]);

  useEffect(() => {
    return () => {
      const player = getInstance();
      if (player.getStatus().filePath === currentFilePath) {
        player.stop().catch(() => {});
      }
    };
  }, [currentFilePath]);

  useInput(
    (input, key) => {
      if (isDiffMode) {
        if (key.return) {
          onConfirmDiff();
          return;
        }
        if (key.escape) {
          onCancelDiff();
          return;
        }
        return;
      }

      if (key.leftArrow && !key.shift) {
        onInnerFocusSwitch();
        return;
      }

      if (input === " " && !key.ctrl && !key.meta) {
        const player = getInstance();
        const status = player.getStatus();
        if (
          status.filePath === currentFilePath &&
          (status.isPlaying || status.isPaused)
        ) {
          player.togglePause().catch(() => {});
        } else if (currentFilePath && source?.localFile?.state === "found") {
          player.play(currentFilePath).catch(() => {});
        }
        return;
      }

      if (key.leftArrow && key.shift) {
        const player = getInstance();
        const status = player.getStatus();
        if (
          status.filePath === currentFilePath &&
          (status.isPlaying || status.isPaused)
        ) {
          player.seekMs(Math.max(0, status.positionMs - 5000)).catch(() => {});
        }
        return;
      }

      if (key.rightArrow && key.shift) {
        const player = getInstance();
        const status = player.getStatus();
        if (
          status.filePath === currentFilePath &&
          (status.isPlaying || status.isPaused)
        ) {
          player
            .seekMs(Math.min(status.durationMs, status.positionMs + 5000))
            .catch(() => {});
        }
        return;
      }

      if (key.ctrl && input === "f") {
        if (source?.localFile?.state === "not_found") onRelocateFile();
        return;
      }
    },
    { isActive },
  );

  const providerLabel = source ? source.provider.toUpperCase() : "NO SOURCE";
  const innerW = width - 2;
  const dashes = Math.max(0, innerW - providerLabel.length - 2);
  const leftD = Math.floor(dashes / 2);
  const rightD = dashes - leftD + 1;
  const borderLeft = `┌${"─".repeat(leftD)} `;
  const borderRight = ` ${"─".repeat(rightD)}┐`;

  if (isDiffMode && source && pendingSource) {
    return (
      <DiffView
        source={source}
        pendingSource={pendingSource}
        width={width}
        height={height}
      />
    );
  }

  if (!source) {
    return null;
  }

  const fileNotFound = source.localFile?.state === "not_found";
  const sourceDurationMs =
    source.fileInfo?.durationMs ?? source.track.duration ?? 0;
  const displayDurationMs = durationMs > 0 ? durationMs : sourceDurationMs;
  const filename = source.localFile
    ? `${source.localFile.name}.${source.localFile.extension}`
    : "—";
  const sizeText = source.fileInfo
    ? formatBytes(source.fileInfo.sizeBytes)
    : "—";
  const formatLabel = (source.fileInfo?.format ?? "flac").toUpperCase();
  const embeddedTags = source.fileInfo?.embeddedTags ?? {};
  const otherTagKeys = Object.keys(embeddedTags)
    .map((k) => k.toUpperCase())
    .filter((k) => !PRIORITY_TAGS.includes(k));
  const canPlay = source.localFile?.state === "found";

  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      <Box flexDirection="column" height={1} flexShrink={0} overflow="hidden">
        <Box flexDirection="row">
          <Text color="gray">{borderLeft}</Text>
          <Text color={getProviderColor(source?.provider ?? "") as any}>
            {providerLabel}
          </Text>
          <Text color="gray">{borderRight}</Text>
        </Box>
      </Box>

      <Box
        flexDirection="column"
        flexGrow={1}
        overflow="hidden"
        borderStyle="single"
        borderColor="gray"
        borderTop={false}
      >
        <Box flexDirection="column" flexGrow={1} overflow="hidden">
          {canPlay && (
            <PlaybackBar
              positionMs={positionMs}
              durationMs={displayDurationMs}
              width={innerW}
              isPlaying={isPlaying}
              isPaused={isPaused}
            />
          )}

          {fileNotFound ? (
            <Box flexDirection="column" paddingX={1} paddingY={1}>
              <Text color="yellow">⚠ File not found</Text>
              <Text color="gray" dimColor wrap="truncate-end">
                Last known: {source.localFile?.path ?? "—"}
              </Text>
              <Box marginTop={1}>
                <Text color="white" bold>
                  [Ctrl+F]
                </Text>
                <Text color="gray"> Relocate file</Text>
              </Box>
            </Box>
          ) : (
            <Box flexDirection="column" flexShrink={0}>
              <DetailRow label="1" value={"1"} />
              <DetailRow label="2" value={"2"} />
              <DetailRow label="3" value={"3"} />
              <DetailRow label="4" value={"4"} />
              <DetailRow label="5" value={"5"} />
              <DetailRow label="6" value={"6"} />
              <DetailRow label="7" value={"7"} />
              <DetailRow label="File" value={filename} />
              <DetailRow label="Format" value={formatLabel} />
              <DetailRow label="Size" value={sizeText} />
              <DetailRow
                label="Duration"
                value={formatDuration(sourceDurationMs)}
              />
            </Box>
          )}

          {!fileNotFound && (
            <>
              <Box height={1} flexDirection="column" />
              <SectionDivider label="Embedded Tags" width={innerW} />
              {PRIORITY_TAGS.map((tag) => (
                <DetailRow
                  key={tag}
                  label={tag}
                  value={tagValue(embeddedTags, tag)}
                />
              ))}
              {otherTagKeys.map((tag) => (
                <DetailRow
                  key={tag}
                  label={tag}
                  value={tagValue(embeddedTags, tag)}
                />
              ))}
            </>
          )}

          {source.savedFile && (
            <Box flexDirection="column" overflow="hidden" marginTop={1}>
              <SectionDivider label="Saved" width={innerW} />
              <DetailRow label="Path" value={source.savedFile.path} />
              <DetailRow
                label="Saved at"
                value={formatDate(source.savedFile.savedAt)}
              />
            </Box>
          )}
        </Box>

        {/* Keyboard shortcuts */}
        <Box flexDirection="column" height={1} minHeight={1} overflow="hidden">
          <Box flexDirection="row" paddingX={1} overflow="hidden" flexGrow={1}>
            {isActive && canPlay && (
              <Hint
                label={isPaused ? "Resume" : isPlaying ? "Pause" : " Play"}
                shortcut="Space"
              />
            )}
            {isActive && canPlay && (isPlaying || isPaused) && (
              <Hint label="Seek 5s" shortcut="⇧←/⇧→" />
            )}
            {isActive && fileNotFound && (
              <Hint label="Relocate" shortcut="Ctrl+F" />
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  );
};
