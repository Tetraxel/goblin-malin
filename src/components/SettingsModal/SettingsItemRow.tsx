import React from "react";
import { Box, Text } from "ink";
import { TextInput } from "#components/TextInput";
import { ClickArea } from "#base/mouse/ClickArea";
import { useTheme } from "#base/themeContext";
import { ITEM_ICONS, LABEL_OFFSET, VALUE_GAP, type SettingsItem } from "#settings/buildSettingsItems";
import { sanitizeInput } from "#utils/string";

/**
 * What a left-click on a row asks for. A click only selects the row, so a stray click never changes a setting or runs
 * an action (a second click on the selected row, or Enter, does). The controls themselves act at once: the checkbox
 * cell ticks, a select's ◀ / ▶ steps.
 */
export type SettingsClick = { kind: "select" } | { kind: "toggle" } | { kind: "step"; step: 1 | -1 };

interface SettingsItemRowProps {
    item: SettingsItem;
    isSelected: boolean;
    isEditing: boolean;
    editValue: string;
    onEditChange: (v: string) => void;
    onEditSubmit: (v: string) => void;
    innerWidth: number;
    /** For a row with a value: the width of its block's label column (`valueColumns`). */
    labelWidth?: number;
    onClick?: (click: SettingsClick) => void;
}

/** A rule from after `used` columns to the end of the row. */
const rule = (char: string, width: number, used: number) => char.repeat(Math.max(0, width - used));

export const SettingsItemRow: React.FC<SettingsItemRowProps> = ({
    item,
    isSelected,
    isEditing,
    editValue,
    onEditChange,
    onEditSubmit,
    innerWidth,
    labelWidth,
    onClick,
}) => {
    const theme = useTheme();

    switch (item.kind) {
        case "sectionHeader":
            return (
                <Box marginTop={1} flexShrink={0}>
                    <Text bold color={theme.text.heading}>
                        {item.label.toUpperCase()}
                    </Text>
                    <Text color={theme.ui.separator}>{" " + rule("━", innerWidth, item.label.length + 1)}</Text>
                </Box>
            );

        case "subHeader":
            return (
                <Box paddingTop={1} paddingLeft={2} flexShrink={0}>
                    <Text bold color={theme.text.secondary}>
                        {item.label}
                    </Text>
                </Box>
            );

        case "providerHeader": {
            const WARNING = " △ Missing credentials";
            const used = 4 + item.label.length + 1 + (item.missingCredentials ? WARNING.length : 0) + 1;
            return (
                <Box paddingLeft={4} flexShrink={0}>
                    <Text color={item.color} bold>
                        {item.label}
                    </Text>
                    {item.missingCredentials && <Text color={theme.status.warning}>{WARNING}</Text>}
                    <Text color={theme.ui.separator}>{" " + rule("─", innerWidth, used)}</Text>
                </Box>
            );
        }

        case "note":
            // Under the row above it, in line with that row's label.
            return (
                <Box paddingLeft={item.indent + LABEL_OFFSET} flexShrink={0}>
                    <Text color={theme.text.secondary} wrap="truncate-end">
                        {item.text}
                    </Text>
                </Box>
            );

        default:
            break;
    }

    // Every other row: indent, cursor, icon, label, then the value in its block's column.
    const focus = isSelected ? theme.ui.focusIndicator : undefined;
    const checked = item.kind === "checkbox" && item.get();
    const boxIcon = checked ? "☑" : "☐";
    const icon = item.kind === "checkbox" ? boxIcon : (item.icon ?? ITEM_ICONS[item.kind]);
    const iconColor =
        item.kind === "checkbox"
            ? checked
                ? theme.status.success
                : theme.text.secondary
            : (focus ?? theme.text.secondary);
    const withValue = item.kind === "textInput" || item.kind === "select" || item.kind === "readonlyText";
    const labelColumn = withValue ? (labelWidth ?? item.label.length) : undefined;
    // Where the select's arrows are, from the row's left edge (indent included): ◀ starts the value, ▶ ends it.
    const valueX = item.indent + LABEL_OFFSET + (labelColumn ?? 0) + VALUE_GAP;

    const handleClick = (x: number) => {
        // The checkbox cell (the box and the spaces around it) ticks at once.
        if (item.kind === "checkbox" && x >= item.indent + 2 && x <= item.indent + 4)
            return onClick?.({ kind: "toggle" });
        if (item.kind === "select") {
            const value = item.get();
            if (x === valueX) return onClick?.({ kind: "step", step: -1 });
            if (x === valueX + value.length + 3) return onClick?.({ kind: "step", step: 1 });
        }
        onClick?.({ kind: "select" });
    };

    return (
        <ClickArea
            window="settingsModal"
            onClick={(event, bounds) => handleClick(event.x - bounds.x)}
            paddingLeft={item.indent}
            flexShrink={0}
            backgroundColor={isSelected ? theme.ui.rowBackground.regular.highlighted : undefined}
        >
            <Box width={2} flexShrink={0}>
                <Text color={theme.ui.focusIndicator}>{isSelected ? "☛" : ""}</Text>
            </Box>
            <Box width={LABEL_OFFSET - 2} flexShrink={0}>
                <Text color={iconColor}>{icon}</Text>
            </Box>
            {labelColumn !== undefined ? (
                <Box width={labelColumn + VALUE_GAP} flexShrink={1}>
                    <Text color={focus} bold={isSelected}>
                        {item.label}
                    </Text>
                </Box>
            ) : (
                <Box flexShrink={1}>
                    <Text color={focus} bold={isSelected}>
                        {item.label}
                    </Text>
                </Box>
            )}
            {item.kind === "select" && (
                <Box flexShrink={0}>
                    <Text color={theme.text.secondary}>◀ </Text>
                    <Text color={theme.text.active} bold>
                        {item.get()}
                    </Text>
                    <Text color={theme.text.secondary}> ▶</Text>
                </Box>
            )}
            {item.kind === "textInput" &&
                (isEditing ? (
                    <Box flexShrink={1} flexGrow={1}>
                        <Text color={theme.text.secondary}>[ </Text>
                        <TextInput
                            value={editValue}
                            onChange={(v) => onEditChange(sanitizeInput(v))}
                            onSubmit={onEditSubmit}
                            focus
                        />
                    </Box>
                ) : (
                    <Box flexShrink={0}>
                        <Text color={theme.text.secondary}>[ </Text>
                        {item.get() ? (
                            <Text color={theme.text.active}>{item.get()}</Text>
                        ) : (
                            <Text color={theme.text.muted} italic>
                                empty
                            </Text>
                        )}
                        <Text color={theme.text.secondary}> ]</Text>
                    </Box>
                ))}
            {item.kind === "readonlyText" && (
                // The value truncates in the middle, so a path's tail stays visible.
                <Box flexShrink={1} flexGrow={1} minWidth={0}>
                    <Text color={theme.text.secondary} wrap="truncate-middle">
                        {item.value}
                    </Text>
                </Box>
            )}
        </ClickArea>
    );
};
