import React from "react";
import { Box, Text } from "ink";
import { itemRowHeight, type SettingsItem } from "#settings/buildSettingsItems";
import { SettingsItemRow } from "./SettingsItemRow";
import { SearchBar } from "../SearchBar";

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
    onSearchClick: () => void;
    /** Left-click on an interactive row; `step` is set when a select's ◀/▶ was hit. */
    onItemClick: (index: number, step?: 1 | -1) => void;
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
    onSearchClick,
    onItemClick,
}) => {
    const listAreaH = Math.max(3, height - SEARCH_H);
    // Heights count wrapped lines: a long label takes 2+ rows, and counting it as one clips the last rows.
    const heights = items.map((item) => itemRowHeight(item, width));
    const rowStarts: number[] = [];
    let cumRows = 0;
    for (const h of heights) {
        rowStarts.push(cumRows);
        cumRows += h;
    }
    const totalRows = cumRows;
    const scrolls = totalRows > listAreaH;
    // When the list scrolls, the "↕ x–y of z" line below it takes one row of the area.
    const capacity = scrolls ? listAreaH - 1 : listAreaH;
    const selectedRowStart = rowStarts[selectedIndex] ?? 0;
    const scrollRowOffset = Math.max(
        0,
        Math.min(selectedRowStart - Math.floor(capacity / 2), Math.max(0, totalRows - capacity))
    );
    const rawStart = rowStarts.findIndex((r) => r >= scrollRowOffset);
    const visibleStart = rawStart < 0 ? 0 : rawStart;
    const visibleItems: { item: SettingsItem; idx: number }[] = [];
    let visibleRows = 0;
    for (let i = visibleStart; i < items.length; i++) {
        const h = heights[i];
        if (visibleRows + h > capacity) break;
        visibleItems.push({ item: items[i], idx: i });
        visibleRows += h;
    }

    return (
        <Box flexDirection="column" width={width} height={height} overflow="hidden">
            <SearchBar
                value={searchQuery}
                onChange={onSearchChange}
                placeholder="Search settings…"
                highlighted={searchFocused && editingIndex === null}
                inputFocus={searchFocused && isActive && editingIndex === null}
                mouseWindow="settingsModal"
                onFocusRequest={onSearchClick}
            />

            <Box flexDirection="column" overflow="hidden" flexGrow={1} flexShrink={0}>
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
                            onClick={(step) => onItemClick(idx, step)}
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
                        {scrolls && (
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
