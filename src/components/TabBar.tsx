import React, { useRef } from "react";
import { Box, Text, type DOMElement } from "ink";
import { useTheme } from "#base/themeContext";
import { useTabBarMouse } from "./useTabBarMouse";

export interface TabDef {
    key: string;
    label: string;
}

interface TabBarProps {
    width: number;
    tabs: TabDef[];
    activeTabKey: string;
    /** If provided, inserts a ┴ junction at this x position instead of a plain ├ */
    splitPos?: number;
    /** The last character of the line: ┤ closes it on the frame; ┬ when a vertical line starts under it and `trailing` goes on. */
    endChar?: string;
    /** Drawn on the same row after the bar (the title of a panel beside it). */
    trailing?: React.ReactNode;
    /** Called with the tab's key when it is clicked. Tabs are not clickable without it. */
    onSelect?: (key: string) => void;
}

export const TabBar: React.FC<TabBarProps> = ({
    width,
    tabs,
    activeTabKey,
    splitPos,
    endChar = "┤",
    trailing,
    onSelect,
}) => {
    const theme = useTheme();
    const tabRefs = useRef<(DOMElement | null)[]>([]);
    const hoveredKey = useTabBarMouse(
        tabRefs,
        tabs.map((tab) => tab.key),
        onSelect
    );
    const tabsWidth =
        tabs.reduce((sum, tab) => sum + tab.key.length + tab.label.length + 3, 0) + Math.max(0, tabs.length - 1) * 2;
    const lineLen = splitPos !== undefined ? splitPos + 1 : 1;
    const fill = Math.max(0, width - lineLen - 2 - tabsWidth - 3);

    const lineStr =
        splitPos !== undefined
            ? "├" + "─".repeat(Math.max(0, splitPos - 1)) + "┴" + "─".repeat(fill)
            : "├" + "─".repeat(fill);

    const bar = (
        <Box height={1} width={width} overflow="hidden" flexShrink={0}>
            <Text color={theme.ui.border}>{lineStr}</Text>
            <Text color={theme.ui.border}>{"  "}</Text>
            {tabs.map((tab, i) => {
                const isActive = tab.key === activeTabKey;
                const isHovered = tab.key === hoveredKey;
                return (
                    <React.Fragment key={tab.key}>
                        {i > 0 && <Text color={theme.ui.border}>{"  "}</Text>}
                        <Box
                            flexShrink={0}
                            ref={(node: DOMElement | null) => {
                                tabRefs.current[i] = node;
                            }}
                        >
                            <Text color={theme.text.primary} bold={isActive}>{`[${tab.key}] `}</Text>
                            <Text
                                color={
                                    isActive
                                        ? theme.action.primary
                                        : isHovered
                                          ? theme.ui.tabHover
                                          : theme.ui.tabInactive
                                }
                                bold={isActive}
                                underline={isHovered}
                            >
                                {tab.label}
                            </Text>
                        </Box>
                    </React.Fragment>
                );
            })}
            <Text color={theme.ui.border}>{` ─${endChar}`}</Text>
        </Box>
    );
    return trailing ? (
        <Box height={1} flexShrink={0}>
            {bar}
            {trailing}
        </Box>
    ) : (
        bar
    );
};
