import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import fs from "fs";
import { Task, TaskSnapshot } from "../../../base/task/task";
import { useFocusContext } from "../../../contexts/FocusContext";
import {
  MusicDownloadTaskAttributes,
  MetadataSourceState,
  MetadataOverrides,
  TrackDownloadSource,
} from "../../../flows/musicDownloadFlow/types";
import { DownloadTask } from "../../../flows/musicDownloadFlow/utils/downloadTask";
import { computeCompiledMetadata } from "../../../flows/musicDownloadFlow/utils/compiledMetadata";
import { navigableFields } from "../../../flows/musicDownloadFlow/utils/metadataFields";
import { MetadataSourceList } from "./MetadataSourceList";
import { MetadataDetailPanel } from "./MetadataDetailPanel";
import { SourcesHintBar } from "../SourcesHintBar";
import { DownloadSourceTree } from "../DownloadPanel/DownloadSourceTree/DownloadSourceTree";
import { DownloadSourceDetail } from "../DownloadPanel/DownloadSourceDetail/DownloadSourceDetail";
import { Hint } from "../../Hint";
import { useTheme } from "../../../base/themeContext";

const HINT_BAR_HEIGHT = 2;

interface SourcesPanelProps {
  mode: "metadata" | "download";
  selectedTask: Task | null;
  width: number;
  height: number;
}

export const SourcesPanel: React.FC<SourcesPanelProps> = ({
  mode,
  selectedTask,
  width,
  height,
}) => {
  const theme = useTheme();
  const {
    focusState,
    setSelectedSourceIndex,
    setSourcesInnerFocus,
    setDetailFieldIndex,
  } = useFocusContext();

  const { sourcesPanel } = focusState.secondaryPanel;
  const { selectedSourceIndex, innerFocus, selectedFieldIndex } = sourcesPanel;

  const isPanelActive =
    focusState.activeWindow === "secondaryPanel" &&
    focusState.secondaryPanel.subTab === "sources";

  const typedTask = selectedTask as Task<MusicDownloadTaskAttributes> | null;

  // Subscribe to task changes so mutations (favorite/reject/reorder) trigger re-render
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

  const sources: MetadataSourceState[] =
    snapshot?.attributes?.metadataSources ?? [];
  const overrides: MetadataOverrides =
    snapshot?.attributes?.metadataOverride ?? {};

  const compiled = computeCompiledMetadata(sources, overrides);

  const [splitRatio, setSplitRatio] = useState(0.6);
  const leftWidth = Math.floor(width * splitRatio) - 4; // -4 to avoid overflow on left border
  const rightWidth = width - leftWidth - 4; // -4 to avoid overflow on right border
  const listHeight = height - HINT_BAR_HEIGHT;

  // ← / → switches innerFocus; Shift+← / Shift+→ resizes the detail panel
  useInput(
    (_, key) => {
      if (!isPanelActive || focusState.isEditingField) return;
      // Shift+arrows resize the split (metadata mode or list focused); plain arrows switch focus
      const seekOwnedByDetail = mode === "download" && innerFocus === "detail";
      if (key.shift && key.leftArrow && !seekOwnedByDetail) {
        setSplitRatio((prev) => Math.max(0.2, prev - 0.04));
        return;
      }
      if (key.shift && key.rightArrow && !seekOwnedByDetail) {
        setSplitRatio((prev) => Math.min(0.75, prev + 0.04));
        return;
      }
      if (!key.shift && key.rightArrow && innerFocus === "list") {
        setSourcesInnerFocus("detail");
      }
      if (!key.shift && key.leftArrow && innerFocus === "detail") {
        setSourcesInnerFocus("list");
      }
    },
    { isActive: isPanelActive },
  );

  function handleSourcesChange(updated: MetadataSourceState[]) {
    typedTask?.updateAttributes({ metadataSources: updated });
  }

  function handleOverrideChange(updated: MetadataOverrides) {
    typedTask?.updateAttributes({ metadataOverride: updated });
  }

  // Pass field navigation via up/down when detail is focused
  useInput(
    (_, key) => {
      if (!isPanelActive || innerFocus !== "detail") return;
      if (key.upArrow) setDetailFieldIndex(Math.max(0, selectedFieldIndex - 1));
      if (key.downArrow)
        setDetailFieldIndex(
          Math.min(navigableFields.length - 1, selectedFieldIndex + 1),
        );
    },
    {
      isActive:
        isPanelActive && innerFocus === "detail" && !focusState.isEditingField,
    },
  );

  // ── Download mode ───────────────────────────────────────────────────

  const downloadSources: TrackDownloadSource[] =
    snapshot?.attributes?.downloadSources ?? [];

  // Clamp navigation cursor to valid range for download mode
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

  const [isDiffMode, setIsDiffMode] = useState(false);
  const [pendingSourceIndex, setPendingSourceIndex] = useState<number | null>(
    null,
  );

  function handleRequestSelect(idx: number) {
    // If any source is already saved, enter diff mode before committing
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

  if (mode === "download") {
    const pendingSource =
      pendingSourceIndex !== null
        ? (downloadSources[pendingSourceIndex] ?? null)
        : null;
    const selectedSource =
      downloadNavIndex >= 0
        ? (downloadSources[downloadNavIndex] ?? null)
        : null;
    const canPlaySelected = selectedSource?.localFile?.state === "found";
    const dimHints = !isPanelActive || innerFocus !== "list";

    return (
      <Box
        flexDirection="column"
        height={height}
        overflow="hidden"
        borderStyle="single"
        borderColor={theme.ui.border}
        borderBackgroundColor={theme.ui.background}
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
            savedSource={null}
            compiled={compiled}
            outputDir={""}
            isDiffMode={isDiffMode}
            diffKind="source-switch"
            pendingSource={pendingSource}
            isActive={isPanelActive && innerFocus === "detail"}
            isSaving={false}
            width={rightWidth}
            height={listHeight}
            onInnerFocusSwitch={() => setSourcesInnerFocus("list")}
            onConfirmDiff={handleConfirmDiff}
            onCancelDiff={handleCancelDiff}
            onRelocateFile={handleRelocateFile}
            onSave={() => {}}
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
                <Text color={theme.text.active} dimColor={dimHints} bold>
                  Source {downloadNavIndex + 1}/{downloadSources.length}
                </Text>
              </Box>
            )}
            {selectedSource && (
              <Box marginRight={2}>
                <Text color={theme.text.active} dimColor={dimHints}>
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
  }

  const selectedSource =
    selectedSourceIndex === -1
      ? ("compiled" as const)
      : (sources[selectedSourceIndex] ?? ("compiled" as const));

  return (
    <Box
      flexDirection="column"
      height={height}
      overflow="hidden"
      borderStyle="single"
      borderColor={theme.ui.border}
      borderBackgroundColor={theme.ui.background}
      borderTop={false}
      borderBottom={false}
      paddingRight={1}
    >
      {/* List + Detail split */}
      <Box flexDirection="row" flexGrow={1} overflow="hidden">
        {/* Left: source list */}
        <MetadataSourceList
          sources={sources}
          compiled={compiled}
          overrides={overrides}
          selectedIndex={selectedSourceIndex}
          isActive={isPanelActive && innerFocus === "list"}
          width={leftWidth}
          height={listHeight}
          onSelectSource={setSelectedSourceIndex}
          onInnerFocusSwitch={() => setSourcesInnerFocus("detail")}
          onSourcesChange={handleSourcesChange}
          isDiscovering={snapshot?.attributes?.metadataDiscovering ?? false}
        />

        {/* Right: source detail */}
        <MetadataDetailPanel
          source={selectedSource}
          compiled={compiled}
          overrides={overrides}
          selectedFieldIndex={selectedFieldIndex}
          isActive={isPanelActive && innerFocus === "detail"}
          width={rightWidth}
          height={listHeight}
          onOverrideChange={handleOverrideChange}
          onInnerFocusSwitch={() => setSourcesInnerFocus("list")}
        />
      </Box>

      {/* Bottom: hints bar */}
      <SourcesHintBar
        sources={sources}
        selectedIndex={selectedSourceIndex}
        innerFocus={innerFocus}
        isActive={isPanelActive}
        width={width - 2}
      />
    </Box>
  );
};
