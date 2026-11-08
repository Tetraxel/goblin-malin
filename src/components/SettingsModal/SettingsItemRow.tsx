import React from "react";
import { Box, Text } from "ink";
import { TextInput } from "#components/TextInput";
import { ClickArea } from "#base/mouse/ClickArea";
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
    /** Left-click on an interactive row. `step` is set when a select's ◀ (-1) or ▶ (+1) was hit. */
    onClick?: (step?: 1 | -1) => void;
}

export const SettingsItemRow: React.FC<SettingsItemRowProps> = ({
    item,
    isSelected,
    isEditing,
    editValue,
    onEditChange,
    onEditSubmit,
    innerWidth,
    onClick,
}) => {
    const theme = useTheme();
    const cursor = isSelected ? "☛ " : "  ";

    switch (item.kind) {
        case "sectionHeader":
            return (
                <Box marginTop={1} flexShrink={0}>
                    <Text bold color={theme.text.heading}>
                        {item.label.toUpperCase()}
                    </Text>
                </Box>
            );

        case "subHeader":
            return (
                <Box paddingTop={1} paddingLeft={2} flexShrink={0}>
                    <Text dimColor>{item.label}</Text>
                </Box>
            );

        case "providerHeader": {
            const PROVIDER_INDENT = 2;
            const WARNING = " △ Missing credentials";
            const warningLen = item.missingCredentials ? WARNING.length : 0;
            const padLen = Math.max(0, innerWidth - item.label.length - PROVIDER_INDENT - 4 - warningLen);
            return (
                <Box paddingLeft={4} flexShrink={0}>
                    <Text color={item.color} bold>
                        {item.label + " "}
                    </Text>
                    {item.missingCredentials && <Text color="yellow">{WARNING}</Text>}
                    <Text dimColor>{" " + "─".repeat(padLen)}</Text>
                </Box>
            );
        }

        case "checkbox":
            // ☑︎ is bad on windows terminals, so we use ✔ and ☐ instead
            return (
                <ClickArea window="settingsModal" onClick={() => onClick?.()} paddingLeft={item.indent} flexShrink={0}>
                    <Text color={isSelected ? theme.ui.focusIndicator : undefined} bold={isSelected}>
                        {cursor}
                        {item.get() ? "✔" : "☐"}
                        {"  " + item.label}
                    </Text>
                </ClickArea>
            );

        case "textInput": {
            const prefix = cursor + item.label + ": ";
            return (
                <ClickArea window="settingsModal" onClick={() => onClick?.()} paddingLeft={item.indent} flexShrink={0}>
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
                </ClickArea>
            );
        }

        case "select": {
            // Row layout: indent, cursor, "label: ", then "[value ◀ ▶]" — find the arrows by column.
            const valueText = item.get();
            const arrowsX = item.indent + cursor.length + item.label.length + 2 + 1 + valueText.length + 1;
            return (
                <ClickArea
                    window="settingsModal"
                    onClick={(event, bounds) => {
                        const x = event.x - bounds.x;
                        onClick?.(x === arrowsX ? -1 : 1);
                    }}
                    paddingLeft={item.indent}
                    flexShrink={0}
                >
                    <Text color={isSelected ? theme.ui.focusIndicator : undefined} bold={isSelected}>
                        {cursor}
                        {item.label}:{" "}
                    </Text>
                    <Text color={theme.text.secondary}>[{valueText} ◀ ▶]</Text>
                </ClickArea>
            );
        }

        case "action":
            return (
                <ClickArea window="settingsModal" onClick={() => onClick?.()} paddingLeft={item.indent} flexShrink={0}>
                    <Text color={isSelected ? theme.ui.focusIndicator : undefined} bold={isSelected}>
                        {cursor}
                        {item.label}
                    </Text>
                </ClickArea>
            );

        case "note":
            // Under the row above it, in line with that row's label (cursor + icon).
            return (
                <Box paddingLeft={item.indent + 5} flexShrink={0}>
                    <Text color={theme.text.secondary} wrap="truncate-end">
                        {item.text}
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
