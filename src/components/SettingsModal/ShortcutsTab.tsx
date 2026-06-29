import React, { useReducer, useEffect, useMemo } from "react";
import { Box, Text } from "ink";
import type { Key } from "ink";
import { shortcutRegistry } from "#base/shortcuts/ShortcutRegistry";
import { SettingsStore } from "#settings/settingsStore";
import { Shortcut, getShortcutLiteral } from "#types/actions";
import { useTheme } from "#base/themeContext";
import { SearchBar } from "../SearchBar";

export interface ShortcutsTabItem {
    id: string;
    contextId: string;
    label: string;
    defaultBinding: string;
    customBinding: string | null;
}

// Memoized so that scrolling the list only re-renders the two rows whose
// selection changed — `items` carry stable identity (the build is memoized).
const ShortcutRow = React.memo(function ShortcutRow({
    item,
    isSelected,
    labelColW,
    bindingColW,
}: {
    item: ShortcutsTabItem;
    isSelected: boolean;
    labelColW: number;
    bindingColW: number;
}) {
    const theme = useTheme();
    const binding = item.customBinding ?? item.defaultBinding;
    const isCustom = item.customBinding !== null;
    return (
        <Box paddingX={1} height={1} flexShrink={0} flexDirection="row" overflow="hidden">
            <Text color={isSelected ? theme.ui.focusIndicator : undefined}>{isSelected ? "☛ " : "  "}</Text>
            <Box flexGrow={1} overflow="hidden">
                <Text wrap="truncate-end" color={isSelected ? theme.text.active : theme.text.secondary}>
                    {item.id}
                </Text>
            </Box>
            <Box flexShrink={0} width={labelColW} overflow="hidden">
                <Text dimColor wrap="truncate-end">
                    {item.label}
                </Text>
            </Box>
            <Box flexShrink={0} width={bindingColW} justifyContent="flex-end">
                <Text color={isCustom ? theme.status.warning : theme.text.muted}>[{binding}]</Text>
            </Box>
        </Box>
    );
});

export function buildShortcutsTabItems(searchQuery?: string): ShortcutsTabItem[] {
    const keybindings = SettingsStore.getInstance().getAppSettings().keybindings;
    const q = (searchQuery ?? "").toLowerCase().trim();
    const all = shortcutRegistry
        .getAllEntries()
        .sort((a, b) => b.priority - a.priority || a.entry.id.localeCompare(b.entry.id))
        .map(({ contextId, entry }) => ({
            id: entry.id,
            contextId,
            label: entry.label,
            defaultBinding: getShortcutLiteral([entry.defaultShortcut]),
            customBinding: keybindings[entry.id] ? getShortcutLiteral([keybindings[entry.id]!]) : null,
        }));
    if (!q) return all;
    return all.filter((item) => item.id.toLowerCase().includes(q) || item.label.toLowerCase().includes(q));
}

export function buildShortcutFromKey(input: string, key: Key): Shortcut | null {
    const mods = {
        ctrl: key.ctrl || undefined,
        shift: key.shift || undefined,
        meta: key.meta || undefined,
    };
    if (key.escape) return null;
    if (key.upArrow) return { key: "upArrow", ...mods };
    if (key.downArrow) return { key: "downArrow", ...mods };
    if (key.leftArrow) return { key: "leftArrow", ...mods };
    if (key.rightArrow) return { key: "rightArrow", ...mods };
    if (key.return) return { key: "return", ...mods };
    if (key.tab) return { key: "tab", shift: key.shift || undefined };
    if (key.delete) return { key: "delete" };
    if (key.backspace) return { key: "backspace" };
    if (key.pageUp) return { key: "pageUp" };
    if (key.pageDown) return { key: "pageDown" };
    if (input && input.length === 1) return { input, ...mods };
    return null;
}

// marginTop(1) + border+content height(3)
const SEARCH_H = 4;
const REBIND_H = 2;

interface ShortcutsTabProps {
    isActive: boolean;
    selectedIndex: number;
    rebindingId: string | null;
    width: number;
    height: number;
    searchQuery: string;
    searchFocused: boolean;
    onSearchChange: (v: string) => void;
}

export const ShortcutsTab: React.FC<ShortcutsTabProps> = ({
    isActive,
    selectedIndex,
    rebindingId,
    width,
    height,
    searchQuery,
    searchFocused,
    onSearchChange,
}) => {
    const theme = useTheme();
    const [registryVersion, forceUpdate] = useReducer((x: number) => x + 1, 0);
    useEffect(() => shortcutRegistry.subscribe(forceUpdate), []);

    // Rebuilding sorts the whole registry; only redo it when the search or the
    // registry itself changes — not on every scroll step (selectedIndex change).
    const items = useMemo(
        () => buildShortcutsTabItems(searchQuery),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [searchQuery, registryVersion]
    );
    const safeIdx = Math.max(0, Math.min(selectedIndex, items.length - 1));

    const rebindUsedH = rebindingId ? REBIND_H : 0;
    const listAreaH = Math.max(1, height - SEARCH_H - rebindUsedH);
    const scrollOffset = Math.max(
        0,
        Math.min(safeIdx - Math.floor(listAreaH / 2), Math.max(0, items.length - listAreaH))
    );
    const visibleItems = items.slice(scrollOffset, scrollOffset + listAreaH);

    const bindingColW = 16;
    const labelColW = 14;

    return (
        <Box flexDirection="column" width={width} height={height} overflow="hidden">
            <SearchBar
                value={searchQuery}
                onChange={onSearchChange}
                placeholder="Search shortcuts…"
                highlighted={searchFocused && !rebindingId}
                inputFocus={searchFocused && isActive && !rebindingId}
            />
            {rebindingId && (
                <Box paddingX={1} height={REBIND_H} flexShrink={0} flexDirection="column">
                    <Text color={theme.action.primary} bold>
                        Press new shortcut key…
                    </Text>
                    <Text dimColor>Rebinding: {rebindingId} [Esc] Cancel</Text>
                </Box>
            )}
            <Box flexDirection="column" flexGrow={1} overflow="hidden">
                {visibleItems.map((item, i) => {
                    const idx = scrollOffset + i;
                    const isSelected = isActive && idx === safeIdx && !rebindingId && !searchFocused;
                    return (
                        <ShortcutRow
                            key={item.id}
                            item={item}
                            isSelected={isSelected}
                            labelColW={labelColW}
                            bindingColW={bindingColW}
                        />
                    );
                })}
                {items.length === 0 && searchQuery && (
                    <Text italic dimColor>
                        {" "}
                        No shortcuts match &quot;{searchQuery}&quot;
                    </Text>
                )}
            </Box>
        </Box>
    );
};
