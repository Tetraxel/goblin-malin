import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "#base/themeContext";

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
}

export const TabBar: React.FC<TabBarProps> = ({ width, tabs, activeTabKey, splitPos }) => {
    const theme = useTheme();
    const tabsWidth =
        tabs.reduce((sum, tab) => sum + tab.key.length + tab.label.length + 3, 0) + Math.max(0, tabs.length - 1) * 2;
    const lineLen = splitPos !== undefined ? splitPos + 1 : 1;
    const fill = Math.max(0, width - lineLen - 2 - tabsWidth - 3);

    const lineStr =
        splitPos !== undefined
            ? "├" + "─".repeat(Math.max(0, splitPos - 1)) + "┴" + "─".repeat(fill)
            : "├" + "─".repeat(fill);

    return (
        <Box height={1} width={width} overflow="hidden">
            <Text color={theme.ui.border}>{lineStr}</Text>
            <Text color={theme.ui.border}>{"  "}</Text>
            {tabs.map((tab, i) => {
                const isActive = tab.key === activeTabKey;
                return (
                    <React.Fragment key={tab.key}>
                        {i > 0 && <Text color={theme.ui.border}>{"  "}</Text>}
                        <Text color={theme.text.primary} bold={isActive}>{`[${tab.key}] `}</Text>
                        <Text color={isActive ? theme.action.primary : theme.ui.tabInactive} bold={isActive}>
                            {tab.label}
                        </Text>
                    </React.Fragment>
                );
            })}
            <Text color={theme.ui.border}>{" ─┤"}</Text>
        </Box>
    );
};
