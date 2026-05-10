import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { useFocusContext } from "../contexts/FocusContext";
import { SettingsStore } from "../settings/settingsStore";
import { AppSettings } from "../settings/appSettings";
import { buildGlobalSettingsItems } from "../settings/buildGlobalSettingsItems";
import {
  filterSettingsItems,
  isInteractive,
  itemRowHeight,
  SettingsItem,
} from "../settings/buildSettingsItems";
import { deepMerge } from "../utils/deepMerge";
import { DeepPartial } from "../utils/types";
import { FlowBase } from "../base/flow/flow-base";
import { SettingsItemRow } from "./SettingsItemRow";
import { Hint } from "./Hint";

// Rows consumed by modal chrome: borders(2) + paddingY(2) + title(1) + marginTop(1)
// + search-border(2) + search-row(1) + marginTop(1) + marginTop(1) + footer(1) = 14
const MODAL_OVERHEAD = 14;

interface SettingsModalProps {
  terminalHeight: number;
  terminalWidth: number;
  currentFlow: FlowBase | undefined;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  terminalHeight,
  terminalWidth,
  currentFlow,
}) => {
  const { focusState, switchBack } = useFocusContext();
  const isActive = focusState.activeWindow === "settingsModal";

  const [appDraft, setAppDraft] = useState<AppSettings>(() =>
    SettingsStore.getInstance().getAppSettings(),
  );
  // Stores only pending changes; merged onto live settings when building items or saving
  const [flowPatch, setFlowPatch] = useState<Record<string, unknown>>({});
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [modalFocus, setModalFocus] = useState<"search" | "list">("search");

  // Reset to fresh settings each time the modal opens
  useEffect(() => {
    if (!isActive) return;
    setAppDraft(SettingsStore.getInstance().getAppSettings());
    setFlowPatch({});
    setSelectedIndex(0);
    setEditingIndex(null);
    setEditValue("");
    setSearchQuery("");
    setModalFocus("search");
  }, [isActive]);

  const allItems = useMemo((): SettingsItem[] => {
    const globalItems = buildGlobalSettingsItems(appDraft, (patch) =>
      setAppDraft((prev) => deepMerge(prev, patch as DeepPartial<AppSettings>)),
    );
    // Always merge patch onto the live settings so buildFlowSettingsItems gets a complete object
    const fullFlowSettings = deepMerge(
      (currentFlow?.getFlowSettings?.() ?? {}) as Record<string, unknown>,
      flowPatch,
    );
    const flowItems =
      currentFlow?.buildFlowSettingsItems?.(fullFlowSettings, (patch) =>
        setFlowPatch(
          (prev) => deepMerge(prev, patch) as Record<string, unknown>,
        ),
      ) ?? [];
    return [...globalItems, ...flowItems];
  }, [appDraft, flowPatch, currentFlow]);

  const filteredItems = useMemo(
    () => filterSettingsItems(allItems, searchQuery),
    [allItems, searchQuery],
  );

  // Keep selectedIndex in bounds when the list shrinks
  useEffect(() => {
    setSelectedIndex((prev) =>
      Math.min(prev, Math.max(0, filteredItems.length - 1)),
    );
  }, [filteredItems.length]);

  // ── Global handler: Ctrl+S, Esc, and search→list transition ───────────────
  useInput(
    (input, key) => {
      if (key.ctrl && input === "s") {
        SettingsStore.getInstance().writeAppSettings(appDraft);
        if (currentFlow?.saveFlowSettings) {
          const fullFlowSettings = deepMerge(
            (currentFlow.getFlowSettings?.() ?? {}) as Record<string, unknown>,
            flowPatch,
          );
          currentFlow.saveFlowSettings(fullFlowSettings);
        }
        switchBack();
        return;
      }

      if (key.escape) {
        if (editingIndex !== null) {
          setEditingIndex(null);
          return;
        }
        if (searchQuery) {
          setSearchQuery("");
          setModalFocus("search");
          return;
        }
        switchBack(); // discard patch
        return;
      }

      // Move from search bar down into the list
      if (modalFocus === "search" && (key.downArrow || key.return)) {
        const first = filteredItems.findIndex(isInteractive);
        setSelectedIndex(first >= 0 ? first : 0);
        setModalFocus("list");
        return;
      }
    },
    { isActive },
  );

  // ── List navigation (active only when list is focused and not editing) ─────
  useInput(
    (input, key) => {
      if (key.upArrow) {
        let newIdx = selectedIndex - 1;
        while (newIdx >= 0 && !isInteractive(filteredItems[newIdx])) newIdx--;
        if (newIdx < 0) {
          setModalFocus("search");
          return;
        }
        setSelectedIndex(newIdx);
        return;
      }

      if (key.downArrow) {
        let newIdx = selectedIndex + 1;
        while (
          newIdx < filteredItems.length &&
          !isInteractive(filteredItems[newIdx])
        )
          newIdx++;
        if (newIdx < filteredItems.length) setSelectedIndex(newIdx);
        return;
      }

      const item = filteredItems[selectedIndex];
      if (!item || !isInteractive(item)) return;

      if (key.return) {
        if (item.kind === "checkbox") {
          item.set(!item.get());
          return;
        }
        if (item.kind === "textInput") {
          setEditValue(item.get());
          setEditingIndex(selectedIndex);
          return;
        }
        if (item.kind === "action") {
          item.run();
          return;
        }
      }
    },
    { isActive: isActive && modalFocus === "list" && editingIndex === null },
  );

  // Always render the component tree so hooks are stable; return null when inactive
  if (!isActive) return null;

  const modalWidth = Math.min(90, Math.max(60, terminalWidth - 6));
  const innerWidth = modalWidth - 6;
  const listHeight = Math.max(3, terminalHeight - MODAL_OVERHEAD);

  // Height-aware scroll: sectionHeader/subHeader each render 2 visual rows
  const rowStarts: number[] = [];
  let cumRows = 0;
  for (const item of filteredItems) {
    rowStarts.push(cumRows);
    cumRows += itemRowHeight(item);
  }
  const totalRows = cumRows;

  const selectedRowStart = rowStarts[selectedIndex] ?? 0;
  const scrollRowOffset = Math.max(
    0,
    Math.min(
      selectedRowStart - Math.floor(listHeight / 2),
      Math.max(0, totalRows - listHeight),
    ),
  );

  const rawStart = rowStarts.findIndex((r) => r >= scrollRowOffset);
  const visibleStart = rawStart < 0 ? 0 : rawStart;

  const visibleItems: { item: SettingsItem; idx: number }[] = [];
  let visibleRows = 0;
  for (let i = visibleStart; i < filteredItems.length; i++) {
    const h = itemRowHeight(filteredItems[i]);
    if (visibleRows + h > listHeight) break;
    visibleItems.push({ item: filteredItems[i], idx: i });
    visibleRows += h;
  }

  const searchBorderColor =
    modalFocus === "search" && editingIndex === null ? "yellow" : "gray";

  return (
    <Box
      position="absolute"
      width="100%"
      height={terminalHeight}
      flexDirection="column"
      justifyContent="center"
      alignItems="center"
    >
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="yellow"
        paddingX={2}
        paddingY={1}
        marginX={2}
        marginY={3}
        width={modalWidth}
        backgroundColor="#000000"
        flexGrow={1}
        flexShrink={0}
      >
        {/* Title */}
        <Box justifyContent="space-between">
          <Text bold color="yellow">
            SETTINGS
          </Text>
          {searchQuery ? (
            <Text dimColor>
              Filtering: {filteredItems.length} result
              {filteredItems.length !== 1 ? "s" : ""}
            </Text>
          ) : null}
        </Box>

        {/* Search bar */}
        <Box
          marginTop={1}
          borderStyle="single"
          borderColor={searchBorderColor}
          paddingX={1}
          height={3}
        >
          <Text
            dimColor={modalFocus !== "search"}
            color={modalFocus === "search" ? "yellow" : undefined}
          >
            {"🔎 "}
          </Text>
          <TextInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search settings…"
            focus={modalFocus === "search" && isActive && editingIndex === null}
          />
        </Box>

        {/* Item list */}
        <Box flexDirection="column" overflow="hidden" flexGrow={1}>
          {visibleItems.map(({ item, idx }) => {
            const itemIsSelected =
              idx === selectedIndex && modalFocus === "list";
            const itemIsEditing = editingIndex === idx;
            return (
              <SettingsItemRow
                key={idx}
                item={item}
                isSelected={itemIsSelected}
                isEditing={itemIsEditing}
                editValue={editValue}
                onEditChange={setEditValue}
                onEditSubmit={(v) => {
                  if (item.kind === "textInput") item.set(v);
                  setEditingIndex(null);
                }}
                innerWidth={innerWidth}
              />
            );
          })}
          {filteredItems.length === 0 && (
            <Text italic dimColor>
              {" "}
              No settings match &quot;{searchQuery}&quot;
            </Text>
          )}
          <Box flexDirection="column" overflow="hidden">
            <Box flexDirection="row" flexShrink={0} flexGrow={1}></Box>
            <Box
              flexDirection="row"
              flexShrink={1}
              flexGrow={0}
              alignSelf="flex-end"
            >
              {totalRows > listHeight && (
                <Text dimColor>
                  {"  "}↕ {visibleStart + 1}–
                  {visibleStart + visibleItems.length} of {filteredItems.length}
                </Text>
              )}
            </Box>
          </Box>
        </Box>

        {/* Footer */}
        <Box marginTop={1} flexDirection="row">
          {modalFocus === "search" ? (
            <>
              <Hint label="Go to list" shortcut="↓/Enter" />
              <Hint label="Save & Exit" shortcut="Ctrl+S" />
              <Hint label="Discard" shortcut="Esc" />
            </>
          ) : (
            <>
              <Hint label="Navigate" shortcut="↑↓" />
              <Hint label="Interact" shortcut="Enter" />
              <Hint label="Save & Exit" shortcut="Ctrl+S" />
              <Hint label="Discard" shortcut="Esc" />
            </>
          )}
        </Box>
      </Box>
    </Box>
  );
};
