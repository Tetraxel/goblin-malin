import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import fs from "fs";
import { Task, TaskSnapshot } from "../../../base/task/task";
import { useFocusContext } from "../../../contexts/FocusContext";
import {
  MusicDownloadTaskAttributes,
  TrackDownloadSource,
} from "../../../flows/musicDownloadFlow/types";
import { DownloadTask } from "../../../flows/musicDownloadFlow/utils/downloadTask";
import { DownloadSourceTree } from "./DownloadSourceTree/DownloadSourceTree";
import { DownloadSourceDetail } from "./DownloadSourceDetail/DownloadSourceDetail";
import { Hint } from "../../Hint";

const HINT_BAR_HEIGHT = 2;

interface DownloadPanelProps {
  selectedTask: Task | null;
  width: number;
  height: number;
}

export const DownloadPanel: React.FC<DownloadPanelProps> = ({
  selectedTask,
  width,
  height,
}) => {
  const { focusState, setSelectedSourceIndex, setSourcesInnerFocus } =
    useFocusContext();

  const { sourcesPanel } = focusState.secondaryPanel;
  const { selectedSourceIndex, innerFocus } = sourcesPanel;

  const isPanelActive =
    focusState.activeWindow === "secondaryPanel" &&
    focusState.secondaryPanel.subTab === "sources";

  const typedTask = selectedTask as Task<MusicDownloadTaskAttributes> | null;

  const [snapshot, setSnapshot] = useState<
    TaskSnapshot<MusicDownloadTaskAttributes> | undefined
  >(
    () =>
      typedTask?.get() as TaskSnapshot<MusicDownloadTaskAttributes> | undefined,
  );

  useEffect(() => {
    if (!typedTask) {
      setSnapshot(undefined);
      return;
    }
    return (typedTask as Task<MusicDownloadTaskAttributes>).subscribe((t) => {
      setSnapshot(t.get() as TaskSnapshot<MusicDownloadTaskAttributes>);
    });
  }, [typedTask?.id]);

  const downloadSources: TrackDownloadSource[] =
    snapshot?.attributes?.downloadSources ?? [];

  const downloadNavIndex =
    downloadSources.length === 0
      ? -1
      : Math.max(
          0,
          Math.min(
            selectedSourceIndex < 0 ? 0 : selectedSourceIndex,
            downloadSources.length - 1,
          ),
        );

  const [splitRatio, setSplitRatio] = useState(0.6);
  const leftWidth = Math.floor(width * splitRatio) - 4;
  const rightWidth = width - leftWidth - 4;
  const listHeight = height - HINT_BAR_HEIGHT;

  const [isDiffMode, setIsDiffMode] = useState(false);
  const [pendingSourceIndex, setPendingSourceIndex] = useState<number | null>(
    null,
  );

  // Shift+arrows resize the split only when list is focused (detail owns shift+arrows for seek)
  useInput(
    (_, key) => {
      if (!isPanelActive || focusState.isEditingField) return;
      if (key.shift && key.leftArrow && innerFocus === "list") {
        setSplitRatio((prev) => Math.max(0.2, prev - 0.04));
      }
      if (key.shift && key.rightArrow && innerFocus === "list") {
        setSplitRatio((prev) => Math.min(0.75, prev + 0.04));
      }
    },
    { isActive: isPanelActive },
  );

  function handleRequestSelect(idx: number) {
    const hasSaved = downloadSources.some((s) => s.savedFile != null);
    const isAlreadySelected = downloadSources[idx]?.selected;
    if (hasSaved && !isAlreadySelected) {
      setPendingSourceIndex(idx);
      setIsDiffMode(true);
    } else {
      (typedTask as unknown as DownloadTask)?.selectDownloadSource(idx);
    }
  }

  function handleRejectSource(idx: number) {
    const source = downloadSources[idx];
    if (!source) return;
    (typedTask as unknown as DownloadTask)?.rejectDownloadSource(
      idx,
      !source.isRejected,
    );
  }

  function handleConfirmDiff() {
    if (pendingSourceIndex !== null) {
      (typedTask as unknown as DownloadTask)?.selectDownloadSource(
        pendingSourceIndex,
      );
    }
    setIsDiffMode(false);
    setPendingSourceIndex(null);
  }

  function handleCancelDiff() {
    setIsDiffMode(false);
    setPendingSourceIndex(null);
  }

  async function handleRelocateFile() {
    if (!typedTask) return;
    const attrs = typedTask.getAttributes();
    if (!attrs) return;
    const sourceIdx = downloadNavIndex >= 0 ? downloadNavIndex : 0;
    const source = attrs.downloadSources[sourceIdx];
    if (!source) return;

    const filename = source.localFile?.name ?? "file";
    try {
      const newPath = await typedTask.getPrompt().askInput({
        status: "Relocating file",
        title: "Relocate File",
        message: `Enter new file path for: ${filename}`,
        hint: "Absolute path to the FLAC file",
      });
      if (!newPath.trim()) return;
      if (!fs.existsSync(newPath)) return;
      (typedTask as unknown as DownloadTask)?.updateLocalFile(
        sourceIdx,
        newPath,
      );
    } catch {
      // user cancelled
    }
  }

  const pendingSource =
    pendingSourceIndex !== null
      ? (downloadSources[pendingSourceIndex] ?? null)
      : null;
  const selectedSource =
    downloadNavIndex >= 0 ? (downloadSources[downloadNavIndex] ?? null) : null;
  const canPlaySelected = selectedSource?.localFile?.state === "found";
  const dimHints = !isPanelActive || innerFocus !== "list";

  return (
    <Box
      flexDirection="column"
      height={height}
      overflow="hidden"
      borderStyle="single"
      borderColor="cyan"
      borderTop={false}
      borderBottom={false}
      paddingRight={1}
    >
      <Box flexDirection="row" flexGrow={1} overflow="hidden">
        <DownloadSourceTree
          sources={downloadSources}
          selectedSourceIndex={downloadNavIndex}
          isActive={isPanelActive && innerFocus === "list"}
          width={leftWidth}
          height={listHeight}
          onSelectSource={setSelectedSourceIndex}
          onRequestSelect={handleRequestSelect}
          onRejectSource={handleRejectSource}
          onInnerFocusSwitch={() => setSourcesInnerFocus("detail")}
        />
        <DownloadSourceDetail
          source={selectedSource}
          isDiffMode={isDiffMode}
          pendingSource={pendingSource}
          isActive={isPanelActive && innerFocus === "detail"}
          width={rightWidth}
          height={listHeight}
          onInnerFocusSwitch={() => setSourcesInnerFocus("list")}
          onConfirmDiff={handleConfirmDiff}
          onCancelDiff={handleCancelDiff}
          onRelocateFile={handleRelocateFile}
        />
      </Box>
      <Box
        flexDirection="column"
        width={width - 2}
        overflow="hidden"
        marginLeft={1}
        alignItems="flex-end"
        justifyContent="flex-end"
      >
        <Box flexDirection="row" width={width - 2} overflow="hidden">
          {selectedSource && (
            <Box marginRight={1}>
              <Text color="white" dimColor={dimHints} bold>
                Source {downloadNavIndex + 1}/{downloadSources.length}
              </Text>
            </Box>
          )}
          {selectedSource && (
            <Box marginRight={2}>
              <Text color="white" dimColor={dimHints}>
                {">>>"}
              </Text>
            </Box>
          )}

          <Hint label="Select" shortcut="Enter" dim={dimHints} />
          <Hint
            label={selectedSource?.isRejected ? " Unreject" : " Reject"}
            shortcut="Del"
            dim={dimHints}
          />
          {canPlaySelected && (
            <Hint label="Play/Pause" shortcut="Space" dim={dimHints} />
          )}
        </Box>
      </Box>
    </Box>
  );
};
