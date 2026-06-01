import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { useTheme } from "#base/themeContext";
import { itemRowHeight, SettingsItem } from "#settings/buildSettingsItems";
import { SettingsItemRow } from "./SettingsItemRow";

// marginTop(1) + border+content height(3)
const SEARCH_H = 4;

interface SettingsTabProps {
    isActive: boolean;
    items: SettingsItem[];
    selectedIndex: number;
    editingIndex: number | null;
    editValue: string;
    searchQuery: string;
    searchFocused: boolean;
    width: number;
    height: number;
    onSearchChange: (v: string) => void;
    onEditChange: (v: string) => void;
    onEditSubmit: (item: SettingsItem, v: string) => void;
}

export const SettingsTab: React.FC<SettingsTabProps> = ({
    isActive,
    items,
    selectedIndex,
    editingIndex,
    editValue,
    searchQuery,
    searchFocused,
    width,
    height,
    onSearchChange,
    onEditChange,
    onEditSubmit,
}) => {
    const theme = useTheme();

    const listAreaH = Math.max(3, height - SEARCH_H);
    const rowStarts: number[] = [];
    let cumRows = 0;
    for (const item of items) {
        rowStarts.push(cumRows);
        cumRows += itemRowHeight(item);
    }
    const totalRows = cumRows;
    const selectedRowStart = rowStarts[selectedIndex] ?? 0;
    const scrollRowOffset = Math.max(
        0,
        Math.min(selectedRowStart - Math.floor(listAreaH / 2), Math.max(0, totalRows - listAreaH))
    );
    const rawStart = rowStarts.findIndex((r) => r >= scrollRowOffset);
    const visibleStart = rawStart < 0 ? 0 : rawStart;
    const visibleItems: { item: SettingsItem; idx: number }[] = [];
    let visibleRows = 0;
    for (let i = visibleStart; i < items.length; i++) {
        const h = itemRowHeight(items[i]);
        if (visibleRows + h > listAreaH) break;
        visibleItems.push({ item: items[i], idx: i });
        visibleRows += h;
    }

    const searchBorderColor = searchFocused && editingIndex === null ? theme.action.primary : theme.text.secondary;

    return (
        <Box flexDirection="column" width={width} height={height} overflow="hidden">
            <Box
                marginTop={1}
                borderStyle="single"
                borderColor={searchBorderColor}
                borderBackgroundColor={theme.ui.background}
                paddingX={1}
                height={3}
                flexShrink={0}
            >
                <Text dimColor={!searchFocused} color={searchFocused ? theme.action.primary : undefined}>
                    {"⌕ "}
                </Text>
                <TextInput
                    value={searchQuery}
                    onChange={onSearchChange}
                    placeholder="Search settings…"
                    focus={searchFocused && isActive && editingIndex === null}
                />
            </Box>

            <Box flexDirection="column" overflow="hidden" flexGrow={1}>
                {visibleItems.map(({ item, idx }) => {
                    const itemIsSelected = idx === selectedIndex && !searchFocused;
                    const itemIsEditing = editingIndex === idx;
                    return (
                        <SettingsItemRow
                            key={idx}
                            item={item}
                            isSelected={itemIsSelected}
                            isEditing={itemIsEditing}
                            editValue={editValue}
                            onEditChange={onEditChange}
                            onEditSubmit={(v) => onEditSubmit(item, v)}
                            innerWidth={width}
                        />
                    );
                })}
                {items.length === 0 && searchQuery && (
                    <Text italic dimColor>
                        {" "}
                        No settings match &quot;{searchQuery}&quot;
                    </Text>
                )}
                <Box flexDirection="column" overflow="hidden">
                    <Box flexDirection="row" flexShrink={0} flexGrow={1}></Box>
                    <Box flexDirection="row" flexShrink={1} flexGrow={0} alignSelf="flex-end">
                        {totalRows > listAreaH && (
                            <Text dimColor>
                                {"  "}↕ {visibleStart + 1}–{visibleStart + visibleItems.length} of {items.length}
                            </Text>
                        )}
                    </Box>
                </Box>
            </Box>
        </Box>
    );
};
