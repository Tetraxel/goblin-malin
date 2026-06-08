import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { useTheme } from "#base/themeContext";
import type { SettingsItem } from "#settings/buildSettingsItems";
import { sanitizeInput } from "#utils/string";

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
    const theme = useTheme();
    const cursor = isSelected ? "☛ " : "  ";

    switch (item.kind) {
        case "sectionHeader":
            return (
                <Box marginTop={1}>
                    <Text bold color={theme.text.heading}>
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
            const WARNING = " ⚠ Missing credentials";
            const warningLen = item.missingCredentials ? WARNING.length : 0;
            const padLen = Math.max(0, innerWidth - item.label.length - PROVIDER_INDENT - 4 - warningLen);
            return (
                <Box paddingLeft={4}>
                    <Text color={item.color} bold>
                        {item.label}
                    </Text>
                    {item.missingCredentials && <Text color="yellow">{WARNING}</Text>}
                    <Text dimColor>{" " + "─".repeat(padLen)}</Text>
                </Box>
            );
        }

        case "checkbox":
            return (
                <Box paddingLeft={item.indent}>
                    <Text color={isSelected ? theme.ui.focusIndicator : undefined} bold={isSelected}>
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
                    <Text color={isSelected ? theme.ui.focusIndicator : undefined} bold={isSelected}>
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
                        <Text color={theme.text.secondary}>[{item.get()}]</Text>
                    )}
                </Box>
            );
        }

        case "select":
            return (
                <Box paddingLeft={item.indent}>
                    <Text color={isSelected ? theme.ui.focusIndicator : undefined} bold={isSelected}>
                        {cursor}
                        {item.label}:{" "}
                    </Text>
                    <Text color={theme.text.secondary}>[{item.get()} ◀ ▶]</Text>
                </Box>
            );

        case "action":
            return (
                <Box paddingLeft={item.indent}>
                    <Text color={isSelected ? theme.ui.focusIndicator : undefined} bold={isSelected}>
                        {cursor}
                        {item.label}
                    </Text>
                </Box>
            );

        case "readonlyText":
            return (
                <Box paddingLeft={item.indent} flexShrink={0}>
                    <Text>{"  " + item.label}</Text>
                    <Text italic>{" (read-only)"}</Text>
                    <Text>{": "}</Text>
                    <Text color={theme.text.secondary}>{item.value}</Text>
                </Box>
            );

        default:
            return null;
    }
};
