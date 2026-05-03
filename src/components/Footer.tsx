import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { useFocusContext } from "../contexts/FocusContext";
import { inkTransport } from "../base/logger/ink-transport";
import { LogMetadata } from "../base/logger/types";

export const Footer: React.FC = () => {
  const { focusState } = useFocusContext();
  const height = focusState.footer.height;
  const subTab = focusState.secondaryPanel.subTab;
  const [lastLog, setLastLog] = useState<LogMetadata | null>(null);
  const [logCount, setLogCount] = useState(0);

  useEffect(() => {
    const unsubscribe = inkTransport.subscribe((logs) => {
      if (logs.length > 0) {
        setLastLog(logs[logs.length - 1] as LogMetadata);
        setLogCount((prev) => prev + logs.length);
      }
    });
    return unsubscribe;
  }, []);

  const logText = lastLog
    ? `[${lastLog.level?.toUpperCase() ?? "LOG"}] ${lastLog.message}`
    : "";

  const countSuffix = `${logCount} logs • `;

  return (
    <Box
      borderStyle="single"
      borderColor="cyan"
      paddingX={1}
      borderTop={false}
      overflow="hidden"
      height={height}
    >
      <Text color="gray">
        {subTab === "logs" && <Text color="cyan">{countSuffix}</Text>}
        <Text>{logText}</Text>
      </Text>
    </Box>
  );
};
