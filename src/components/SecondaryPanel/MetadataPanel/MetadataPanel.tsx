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
import { SourcesHintBar } from "../SourcesHintBar";

const HINT_BAR_HEIGHT = 2;

interface MetadataPanelProps {
  selectedTask: Task | null;
  width: number;
  height: number;
}

export const MetadataPanel: React.FC<MetadataPanelProps> = ({
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
  const leftWidth = Math.floor(width * splitRatio) - 4;
  const rightWidth = width - leftWidth - 4;
  const listHeight = height - HINT_BAR_HEIGHT;

  useInput(
    (_, key) => {
      if (!isPanelActive || focusState.isEditingField) return;
      if (key.shift && key.leftArrow) {
        setSplitRatio((prev) => Math.max(0.2, prev - 0.04));
        return;
      }
      if (key.shift && key.rightArrow) {
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

  function handleSourcesChange(updated: MetadataSourceState[]) {
    typedTask?.updateAttributes({ metadataSources: updated });
  }

  function handleOverrideChange(updated: MetadataOverrides) {
    typedTask?.updateAttributes({ metadataOverride: updated });
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
      <Box flexDirection="row" flexGrow={1} overflow="hidden">
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
