import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import type { SettingsItem } from "../settings/buildSettingsItems";
import { sanitizeInput } from "../utils/string";

interface SettingsItemRowProps {
  item: SettingsItem;
  isSelected: boolean;
  isEditing: boolean;
  editValue: string;
  onEditChange: (v: string) => void;
  onEditSubmit: (v: string) => void;
  innerWidth: number;
}

export const SettingsItemRow: React.FC<SettingsItemRowProps> = ({
  item,
  isSelected,
  isEditing,
  editValue,
  onEditChange,
  onEditSubmit,
  innerWidth,
}) => {
  const cursor = isSelected ? "☛ " : "  ";

  switch (item.kind) {
    case "sectionHeader":
      return (
        <Box marginTop={1}>
          <Text bold color="white">
            {item.label.toUpperCase()}
          </Text>
        </Box>
      );

    case "subHeader":
      return (
        <Box paddingTop={1} paddingLeft={2}>
          <Text dimColor>{item.label}</Text>
        </Box>
      );

    case "providerHeader": {
      const PROVIDER_INDENT = 2;
      const padLen = Math.max(
        0,
        innerWidth - item.label.length - PROVIDER_INDENT - 4,
      );
      return (
        <Box paddingLeft={4}>
          <Text color={item.color} bold>
            {item.label}
            <Text dimColor>{" " + "─".repeat(padLen)}</Text>
          </Text>
        </Box>
      );
    }

    case "checkbox":
      return (
        <Box paddingLeft={item.indent}>
          <Text color={isSelected ? "cyan" : undefined} bold={isSelected}>
            {cursor}
            {item.get() ? "☑" : "☐"}
            {"  " + item.label}
          </Text>
        </Box>
      );

    case "textInput": {
      const prefix = cursor + item.label + ": ";
      return (
        <Box paddingLeft={item.indent}>
          <Text color={isSelected ? "cyan" : undefined} bold={isSelected}>
            {prefix}
          </Text>
          {isEditing ? (
            <TextInput
              value={editValue}
              onChange={(v) => onEditChange(sanitizeInput(v))}
              onSubmit={onEditSubmit}
              focus
            />
          ) : (
            <Text color="gray">[{item.get()}]</Text>
          )}
        </Box>
      );
    }

    case "action":
      return (
        <Box paddingLeft={item.indent}>
          <Text color={isSelected ? "cyan" : undefined} bold={isSelected}>
            {cursor}
            {item.label} {">"}
          </Text>
        </Box>
      );

    default:
      return null;
  }
};
