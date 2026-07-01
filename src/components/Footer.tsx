import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { useFocusChrome, useFocusSecondaryPanel } from "#contexts/FocusContext";
import { inkTransport } from "#base/logger/ink-transport";
import { LogMetadata } from "#base/logger/types";
import { useTheme } from "#base/themeContext";
import { statsDisplay } from "#base/statsDisplay";
import { useFps } from "#hooks/useFps";
import { Hint } from "./Hint";

export const Footer: React.FC = () => {
    const theme = useTheme();
    const { footer } = useFocusChrome();
    const secondaryPanel = useFocusSecondaryPanel();
    const height = footer.height;
    const subTab = secondaryPanel.subTab;
    const [lastLog, setLastLog] = useState<LogMetadata | null>(null);
    const [logCount, setLogCount] = useState(0);
    const [showStats, setShowStats] = useState(statsDisplay.get());
    const { fps, minFps, maxFps, renderMs } = useFps(showStats);

    useEffect(() => {
        const unsubscribe = inkTransport.subscribe((logs) => {
            if (logs.length > 0) {
                setLastLog(logs[logs.length - 1] as LogMetadata);
                setLogCount((prev) => prev + logs.length);
            }
        });
        return unsubscribe;
    }, []);

    useEffect(() => statsDisplay.subscribe(setShowStats), []);

    const logText = lastLog ? `[${lastLog.level?.toUpperCase() ?? "LOG"}] ${lastLog.message}` : "";
    const countSuffix = `${logCount} logs • `;

    const fpsColor = fps >= 50 ? theme.status.success : fps >= 30 ? theme.status.warning : theme.status.error;

    return (
        <Box
            borderStyle="single"
            borderColor={theme.ui.border}
            borderBackgroundColor={theme.ui.background}
            paddingX={1}
            borderTop={false}
            overflow="hidden"
            height={height}
            flexDirection="row"
        >
            <Box flexGrow={1} overflow="hidden">
                <Text color={theme.text.secondary} wrap="truncate-end">
                    {subTab === "logs" && <Text color={theme.ui.border}>{countSuffix}</Text>}
                    <Text>{logText}</Text>
                </Text>
            </Box>
            <Box marginLeft={1} flexShrink={0}>
                {showStats ? (
                    <Text>
                        <Text color={theme.text.muted}>fps </Text>
                        <Text color={fpsColor} bold>{String(fps).padStart(2)}</Text>
                        <Text color={theme.text.muted}>  min </Text>
                        <Text color={theme.text.secondary}>{String(minFps).padStart(2)}</Text>
                        <Text color={theme.text.muted}>  max </Text>
                        <Text color={theme.text.secondary}>{String(maxFps).padStart(2)}</Text>
                        <Text color={theme.text.muted}>  </Text>
                        <Text color={theme.text.secondary}>{renderMs.toFixed(1)}</Text>
                        <Text color={theme.text.muted}>ms</Text>
                    </Text>
                ) : (
                    <Hint shortcutId="global.toggleStats" label="Stats" dim />
                )}
            </Box>
        </Box>
    );
};
