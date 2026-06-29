import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { useFocusChrome } from "#contexts/FocusContext";
import { inkTransport } from "#base/logger/ink-transport";
import { LogMetadata } from "#base/logger/types";
import { useTheme } from "#base/themeContext";

export const Footer: React.FC = () => {
    const theme = useTheme();
    const { footer, secondaryPanel } = useFocusChrome();
    const height = footer.height;
    const subTab = secondaryPanel.subTab;
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

    const logText = lastLog ? `[${lastLog.level?.toUpperCase() ?? "LOG"}] ${lastLog.message}` : "";

    const countSuffix = `${logCount} logs • `;

    return (
        <Box
            borderStyle="single"
            borderColor={theme.ui.border}
            borderBackgroundColor={theme.ui.background}
            paddingX={1}
            borderTop={false}
            overflow="hidden"
            height={height}
        >
            <Text color={theme.text.secondary}>
                {subTab === "logs" && <Text color={theme.ui.border}>{countSuffix}</Text>}
                <Text>{logText}</Text>
            </Text>
        </Box>
    );
};
