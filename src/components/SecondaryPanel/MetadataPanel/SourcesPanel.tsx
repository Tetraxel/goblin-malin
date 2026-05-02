import React, { useState, useEffect } from "react";
import { Box, useInput } from "ink";
import { Task, TaskSnapshot } from "../../../base/task/task";
import { useFocusContext } from "../../../contexts/FocusContext";
import {
  MusicDownloadTaskAttributes,
  MetadataSourceState,
  MetadataOverrides,
} from "../../../flows/musicDownloadFlow/types";
import { computeCompiledMetadata } from "../../../flows/musicDownloadFlow/utils/compiledMetadata";
import { navigableFields } from "../../../flows/musicDownloadFlow/utils/metadataFields";
import { MetadataSourceList } from "./MetadataSourceList";
import { MetadataDetailPanel } from "./MetadataDetailPanel";
import { SourcesHintBar } from "./SourcesHintBar";

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
      if (key.leftArrow && key.shift) {
        // Shift+→ : grow detail (shrink list)
        setSplitRatio((prev) => Math.max(0.2, prev - 0.04));
        return;
      }
      if (key.rightArrow && key.shift) {
        // Shift+← : grow list (shrink detail)
        setSplitRatio((prev) => Math.min(0.75, prev + 0.04));
        return;
      }
      if (key.rightArrow && innerFocus === "list") {
        setSourcesInnerFocus("detail");
      }
      if (key.leftArrow && innerFocus === "detail") {
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
      if (key.upArrow) {
        setDetailFieldIndex(Math.max(0, selectedFieldIndex - 1));
      }
      if (key.downArrow) {
        setDetailFieldIndex(
          Math.min(navigableFields.length - 1, selectedFieldIndex + 1),
        );
      }
    },
    {
      isActive:
        isPanelActive && innerFocus === "detail" && !focusState.isEditingField,
    },
  );

  if (mode === "download") {
    return (
      <Box
        flexDirection="row"
        height={height}
        overflow="hidden"
        borderStyle="single"
        borderColor="cyan"
        borderTop={false}
        borderBottom={false}
      >
        <Box paddingX={1}>{/* Download Sources panel implemented in P5 */}</Box>
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
      borderColor="cyan"
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
