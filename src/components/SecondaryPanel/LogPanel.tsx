import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { inkTransport } from "../../base/logger/ink-transport";
import { LogMetadata } from "../../base/logger/types";
import { inspect } from "util";
import { useFocusContext } from "../../contexts/FocusContext";
import { Task } from "../../base/task/task";
import { useTheme } from "../../base/themeContext";

function formatDetails(details?: Record<string, any>): string {
  if (!details || Object.keys(details).length === 0) {
    return "";
  }
  return "\n └ " + JSON.stringify(details);

  // inspect options:
  // depth: null -> recurse indefinitely (show everything)
  // colors: false -> keep it plain string (set true if your logs support ANSI colors)
  // compact: false -> forces indentation/multi-line
  // breakLength: Infinity -> prevents wrapping long lines weirdly
  return `\n${inspect(details, {
    depth: null,
    colors: false,
    compact: false,
    breakLength: Infinity,
  })}`;
}

function getLogString(log: LogMetadata): string {
  const level = `[${log.level.toUpperCase()}]`;
  const flow = log.metadata?.flow ? ` [${log.metadata.flow}]` : "";
  const service = log.metadata?.service ? ` [${log.metadata.service}]` : "";
  const message = ` ${log.message}`;
  const details = formatDetails(log.details);

  return level + flow + service + message + details;
}

export const LogPanel = ({
  tasks,
  width: widthProp,
  height: heightProp,
}: {
  tasks: Task[];
  width?: number;
  height?: number;
}) => {
  const theme = useTheme();
  const { focusState } = useFocusContext();
  const height = heightProp ?? focusState.layout.secondaryPanelHeight;
  const width = widthProp ?? focusState.logPanel.width;

  const selectedTask =
    focusState.activeWindow === "taskList"
      ? tasks?.[focusState.taskList.selectedTaskIndex]
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

  const isActive =
    focusState.activeWindow === "secondaryPanel" &&
    focusState.secondaryPanel.subTab === "logs";

  // Reset scroll when task filter changes or when panel loses focus
  useEffect(() => {
    setScrollOffset(0);
  }, [selectedTask]);

  useEffect(() => {
    if (!isActive) setScrollOffset(0);
  }, [isActive]);

  const filteredLogs = logs.filter(
    (log) =>
      !Boolean(selectedTask) || !Boolean(log.task) || selectedTask === log.task,
  );

  // When scrolled (indicator row visible), only height-1 rows are available for logs
  const maxOffset = Math.max(0, filteredLogs.length - (height - 1));

  useInput(
    (_input, key) => {
      if (key.upArrow) {
        setScrollOffset((prev) => Math.min(prev + 1, maxOffset));
      }
      if (key.downArrow) {
        setScrollOffset((prev) => Math.max(0, prev - 1));
      }
    },
    { isActive },
  );

  const clampedOffset = Math.min(scrollOffset, maxOffset);
  const showIndicator = clampedOffset > 0;
  // Reserve one row for the indicator when it's visible
  const logRows = showIndicator ? height - 1 : height;
  const visibleEnd = showIndicator
    ? filteredLogs.length - clampedOffset
    : undefined;
  const visibleStart = Math.max(
    0,
    (visibleEnd ?? filteredLogs.length) - logRows,
  );
  const visibleLogs = filteredLogs.slice(visibleStart, visibleEnd);

  return (
    <Box
      flexDirection="row"
      overflow="hidden"
      borderStyle="single"
      borderColor={theme.ui.border}
      borderBackgroundColor={theme.ui.background}
      borderTop={false}
      borderBottom={false}
      height={height}
      flexGrow={1}
    >
      <Box flexDirection="column" overflow="hidden" flexGrow={1}>
        {visibleLogs.map((log) => (
          <Box key={log.id} paddingX={1} width={width} height={1}>
            <Text>{getLogString(log)}</Text>
          </Box>
        ))}
        {showIndicator && (
          <Box paddingX={1}>
            <Text color={theme.ui.border} dimColor>
              ↓ {clampedOffset} more below
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
};
