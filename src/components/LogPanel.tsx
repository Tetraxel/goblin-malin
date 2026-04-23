import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { inkTransport } from "../base/logger/ink-transport";
import { LogMetadata } from "../base/logger/types";
import { inspect } from "util";
import { useFocusContext } from "../contexts/FocusContext";
import { Task } from "../base/task/task";

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
  const { focusState } = useFocusContext();
  const height = heightProp ?? focusState.layout.secondaryPanelHeight;
  const width = widthProp ?? focusState.logPanel.width;

  const selectedTask =
    focusState.activeWindow === "taskList"
      ? tasks?.[focusState.taskList.selectedTaskIndex]
      : null;

  const [logs, setLogs] = useState<LogMetadata[]>([]);

  useEffect(() => {
    const unsubscribe = inkTransport.subscribe((incomingLogs) => {
      const normalized = incomingLogs as LogMetadata[];
      setLogs((prevLogs) => [
        ...prevLogs, // Spread the previous (existing) logs
        ...normalized, // Spread the new incoming logs
      ]);
    });
    return unsubscribe; // Cleanup on unmount
  }, []);

  const filteredLogs = logs.filter(
    (log) =>
      !Boolean(selectedTask) || !Boolean(log.task) || selectedTask === log.task,
  );

  return (
    <Box
      flexDirection="column"
      overflow="hidden"
      borderStyle="single"
      borderColor="cyan"
      borderTop={false}
      borderBottom={false}
      height={height}
    >
      {filteredLogs.slice(-height).map((log, index) => (
        <Box key={log.id} paddingX={1} width={width} height={1}>
          <Text>{getLogString(log)}</Text>
        </Box>
      ))}
    </Box>
  );
};
