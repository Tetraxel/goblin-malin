import React, { useEffect, useMemo, useState } from "react";
import { Box, Text } from "ink";
import { useShortcuts } from "#hooks/useShortcuts";
import { useScreenSize } from "#hooks/useScreenSize";
import { useAppSettings } from "#hooks/useAppSettings";
import { useFocusContext } from "#contexts/FocusContext";
import { inkTransport } from "#base/logger/ink-transport";
import { LogLevel, LogMetadata } from "#base/logger/types";
import { Task } from "#base/task/task";
import { useTheme } from "#base/themeContext";
import { formatLogRows } from "./logFormat";

const LEVEL_ORDER: Record<LogLevel, number> = {
    [LogLevel.DEBUG]: 0,
    [LogLevel.INFO]: 1,
    [LogLevel.WARN]: 2,
    [LogLevel.ERROR]: 3,
};

export const LogPanel = ({
    tasks,
    height: heightProp,
    width: widthProp,
}: {
    tasks: Task[];
    height?: number;
    width?: number;
}) => {
    const theme = useTheme();
    const settings = useAppSettings();
    const screen = useScreenSize();
    const { focusState } = useFocusContext();
    const height = heightProp ?? focusState.layout.secondaryPanelHeight;

    // Inner text width = panel width minus left/right border (2) and paddingX (2).
    const innerWidth = Math.max(10, (widthProp ?? screen.width) - 4);

    // Keep the task filter when the user Tabs into the log panel — the taskList
    // focus state (selected index / isHeaderFocused) is preserved across Tab.
    const selectedTask =
        (focusState.activeWindow === "taskList" || focusState.activeWindow === "secondaryPanel") &&
        !focusState.taskList.isHeaderFocused
            ? (tasks?.[focusState.taskList.selectedTaskIndex] ?? null)
            : null;

    const [logs, setLogs] = useState<LogMetadata[]>([]);
    const [scrollOffset, setScrollOffset] = useState(0);

    useEffect(() => {
        const unsubscribe = inkTransport.subscribe((incomingLogs) => {
            const normalized = incomingLogs as LogMetadata[];
            setLogs((prevLogs) => [...prevLogs, ...normalized]);
        });
        return unsubscribe;
    }, []);

    const isActive = focusState.activeWindow === "secondaryPanel" && focusState.secondaryPanel.subTab === "logs";

    const minLevel = LEVEL_ORDER[settings.logs.logLevel];
    const includeGlobal = settings.logs.includeGlobalLogsInFocusedTask;

    const filteredLogs = useMemo(
        () =>
            logs.filter((log) => {
                if (LEVEL_ORDER[log.level] < minLevel) return false;
                if (!selectedTask) return true; // not focusing a task → show everything
                if (log.task === selectedTask) return true; // this task's logs
                if (!log.task && includeGlobal) return true; // optionally include global logs
                return false;
            }),
        [logs, selectedTask, minLevel, includeGlobal]
    );

    // Flatten each log into its visual rows (header + wrapped message + details).
    const allRows = useMemo(
        () => filteredLogs.flatMap((log) => formatLogRows(log, innerWidth)),
        [filteredLogs, innerWidth]
    );

    // Reset scroll when the row set changes meaningfully or the panel loses focus.
    const [prevSelectedTask, setPrevSelectedTask] = useState(selectedTask);
    const [prevIsActive, setPrevIsActive] = useState(isActive);
    const [prevWidth, setPrevWidth] = useState(innerWidth);
    if (prevSelectedTask !== selectedTask) {
        setPrevSelectedTask(selectedTask);
        setScrollOffset(0);
    }
    if (prevWidth !== innerWidth) {
        setPrevWidth(innerWidth);
        setScrollOffset(0);
    }
    if (prevIsActive !== isActive) {
        setPrevIsActive(isActive);
        if (!isActive) setScrollOffset(0);
    }

    // When scrolled (indicator row visible), only height-1 rows are available for logs
    const maxOffset = Math.max(0, allRows.length - (height - 1));

    useShortcuts({
        id: "logPanel",
        isActive,
        priority: 150,
        shortcuts: [
            {
                id: "logPanel.up",
                defaultShortcut: { key: "upArrow" },
                label: "Scroll up",
                handler: () => setScrollOffset((prev) => Math.min(prev + 1, maxOffset)),
            },
            {
                id: "logPanel.down",
                defaultShortcut: { key: "downArrow" },
                label: "Scroll down",
                handler: () => setScrollOffset((prev) => Math.max(0, prev - 1)),
            },
        ],
        hintLines: [
            {
                id: "logPanel.line.scroll",
                left: { type: "text", value: "Logs", bold: true },
                shortcutIds: ["logPanel.up", "logPanel.down"],
            },
        ],
    });

    const clampedOffset = Math.min(scrollOffset, maxOffset);
    const showBottomIndicator = clampedOffset > 0;
    // First pass: determine if a top indicator is needed (without reserving its row yet)
    const rowsNoTop = showBottomIndicator ? height - 1 : height;
    const visibleEnd = showBottomIndicator ? allRows.length - clampedOffset : undefined;
    const visibleStartNoTop = Math.max(0, (visibleEnd ?? allRows.length) - rowsNoTop);
    const showTopIndicator = visibleStartNoTop > 0;
    // Reserve one row per visible indicator
    const rowsAvailable = rowsNoTop - (showTopIndicator ? 1 : 0);
    const visibleStart = Math.max(0, (visibleEnd ?? allRows.length) - rowsAvailable);
    const visibleRows = allRows.slice(visibleStart, visibleEnd);

    return (
        <Box
            flexDirection="row"
            borderStyle="single"
            borderColor={theme.ui.border}
            borderBackgroundColor={theme.ui.background}
            borderTop={false}
            borderBottom={false}
            height={height}
            flexGrow={1}
            overflow="hidden"
        >
            <Box
                flexDirection="column"
                alignSelf="flex-end"
                alignContent="flex-end"
                justifyContent="flex-end"
                overflow="hidden"
                flexGrow={1}
                flexShrink={0}
            >
                {showTopIndicator && (
                    <Box paddingX={1} flexShrink={0}>
                        <Text color={theme.ui.border} dimColor>
                            ↑ {visibleStart} more above
                        </Text>
                    </Box>
                )}
                {visibleRows.map((row) => (
                    <Box key={row.key} paddingX={1} height={1} overflow="hidden" flexShrink={0}>
                        <Text wrap="truncate-end">
                            {row.segments.map((seg, i) => (
                                <Text key={i} color={seg.color} dimColor={seg.dim}>
                                    {seg.text}
                                </Text>
                            ))}
                        </Text>
                    </Box>
                ))}
                {showBottomIndicator && (
                    <Box paddingX={1} flexShrink={0}>
                        <Text color={theme.ui.border} dimColor>
                            ↓ {clampedOffset} more below
                        </Text>
                    </Box>
                )}
            </Box>
        </Box>
    );
};
