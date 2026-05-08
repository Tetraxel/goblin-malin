import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import clipboard from "clipboardy";
import {
  MetadataSourceState,
  MetadataOverrides,
} from "../../../flows/musicDownloadFlow/types";
import {
  CompiledMetadata,
  CompiledMetadataField,
} from "../../../flows/musicDownloadFlow/utils/compiledMetadata";
import {
  FIELDS,
  navigableFields,
} from "../../../flows/musicDownloadFlow/utils/metadataFields";
import { useFocusContext } from "../../../contexts/FocusContext";
import { FieldRow } from "./FieldRow";

interface MetadataSourceDetailProps {
  source: MetadataSourceState | "compiled";
  compiled: CompiledMetadata;
  overrides: MetadataOverrides;
  selectedFieldIndex: number;
  isActive: boolean;
  width: number;
  height: number;
  onOverrideChange: (overrides: MetadataOverrides) => void;
  onInnerFocusSwitch: () => void; // called when ← is pressed to move back to list
}

import { providerDisplayRegistry } from "../../../base/providerDisplay";

function getPlatformBrightColor(apiProvider: string): string {
  return providerDisplayRegistry.get(apiProvider).colorBright;
}

const HINT_BAR_HEIGHT = 1;

function Hint({
  label,
  shortcut,
  dim,
}: {
  label: string;
  shortcut: string;
  dim?: boolean;
}) {
  return (
    <Box marginRight={2}>
      <Text color="white" dimColor={dim} bold>
        [{shortcut}]
      </Text>
      <Text color="gray" dimColor={dim}>
        {" "}
        {label}
      </Text>
    </Box>
  );
}

export const MetadataDetailPanel: React.FC<MetadataSourceDetailProps> = ({
  source,
  compiled,
  overrides,
  selectedFieldIndex,
  isActive,
  width,
  height,
  onOverrideChange,
  onInnerFocusSwitch,
}) => {
  const { setIsEditingField } = useFocusContext();
  const [editingField, setEditingField] =
    useState<CompiledMetadataField | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editError, setEditError] = useState(false);

  function startEditing(fieldKey: CompiledMetadataField, initialValue: string) {
    setEditValue(initialValue);
    setEditError(false);
    setEditingField(fieldKey);
    setIsEditingField(true);
  }

  function stopEditing() {
    setEditingField(null);
    setEditError(false);
    setIsEditingField(false);
  }

  const isCompiled = source === "compiled";
  const clampedFieldIdx = Math.min(
    selectedFieldIndex,
    navigableFields.length - 1,
  );

  useInput(
    (input, key) => {
      if (editingField !== null) {
        if (key.escape) stopEditing();
        return;
      }

      // Guard: plain ← only (Shift+← is reserved for panel resize)
      if (key.leftArrow && !key.shift) {
        onInnerFocusSwitch();
        return;
      }

      // Enter — start editing (only for compiled row with editable field)
      if (key.return && isCompiled) {
        const field = navigableFields[clampedFieldIdx];
        if (!field) return;
        const currentValue = field.getCompiledValue(compiled);
        startEditing(field.key, currentValue === "—" ? "" : currentValue);
        return;
      }

      // Delete — clear override for current field
      if (key.delete && isCompiled) {
        const field = navigableFields[clampedFieldIdx];
        if (!field) return;
        const updated = { ...overrides };
        delete (updated as Record<string, unknown>)[field.key];
        onOverrideChange(updated);
        return;
      }

      // Ctrl+C — copy current field value to clipboard
      if (key.ctrl && input === "c") {
        const field = navigableFields[clampedFieldIdx];
        if (!field) return;
        const value = isCompiled
          ? field.getCompiledValue(compiled)
          : field.getSourceValue(source as MetadataSourceState);
        if (value !== "—")
          try {
            clipboard.writeSync(value);
          } catch {}
        return;
      }
    },
    { isActive },
  );

  function handleEditSubmit(value: string) {
    if (!editingField) return;
    const field = FIELDS.find((f) => f.key === editingField);
    if (!field) return;

    const currentDisplay = field.getCompiledValue(compiled);
    if (value === currentDisplay || (currentDisplay === "—" && value === "")) {
      stopEditing();
      return;
    }

    let parsed: unknown = value;
    if (field.parseValue) {
      parsed = field.parseValue(value);
      if (parsed === null) {
        setEditError(true);
        return;
      }
    }

    onOverrideChange({ ...overrides, [editingField]: parsed });
    stopEditing();
  }

  // ── Header
  const titleInner = width - 2;
  const headerLabel = isCompiled
    ? "Compiled Metadata"
    : source.metadata.platform.toUpperCase();
  const dashes = Math.max(0, titleInner - headerLabel.length - 2);
  const leftD = Math.floor(dashes / 2);
  const rightD = dashes - leftD + 1;
  const borderLeft = `┌${"─".repeat(leftD)} `;
  const borderRight = ` ${"─".repeat(rightD)}┐`;
  const platformColor = isCompiled
    ? "gray"
    : getPlatformBrightColor(
        (source as MetadataSourceState).metadata.apiProvider,
      );

  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      <Box flexDirection="column" height={1} flexShrink={0} overflow="hidden">
        <Box flexDirection="row">
          <Text color="gray">{borderLeft}</Text>
          <Text color={platformColor}>{headerLabel}</Text>
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
          <Box flexDirection="column" flexShrink={0}>
            {FIELDS.map((field) => {
              const isFocused =
                isActive && navigableFields[clampedFieldIdx]?.key === field.key;
              const value = isCompiled
                ? field.getCompiledValue(compiled)
                : field.getSourceValue(source as MetadataSourceState);
              const attr = isCompiled
                ? compiled.attribution[field.key]
                : undefined;
              const isEditing = editingField === field.key;
              const hasOverride =
                isCompiled &&
                overrides[field.key as keyof MetadataOverrides] !== undefined;
              return (
                <FieldRow
                  key={field.key}
                  field={field}
                  isFocused={isFocused}
                  isCompiled={isCompiled}
                  isEditing={isEditing}
                  value={value}
                  attribution={attr}
                  hasOverride={hasOverride}
                  editValue={editValue}
                  editError={editError}
                  onEditValueChange={setEditValue}
                  onEditSubmit={handleEditSubmit}
                />
              );
            })}
          </Box>
        </Box>

        {/* Keyboard shortcuts */}
        <Box flexDirection="column" height={1} minHeight={1} overflow="hidden">
          <Box flexDirection="row" paddingX={1} overflow="hidden" flexGrow={1}>
            {editingField !== null ? (
              <>
                <Hint label="Confirm" shortcut="Enter" />
                <Hint label="Cancel" shortcut="Esc" />
              </>
            ) : (
              <>
                {isActive && isCompiled && (
                  <Hint label="Update" shortcut="Enter" />
                )}
                {isActive && <Hint label="Copy" shortcut="Ctrl+C" />}
              </>
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  );
};
