import React, { useEffect, useRef, useState } from "react";
import { Box, Text } from "ink";
import { useFocusChrome, useFocusSecondaryPanel } from "#contexts/FocusContext";
import { inkTransport } from "#base/logger/ink-transport";
import { LOG_LEVEL_ORDER, type LogLevel, type LogMetadata } from "#base/logger/types";
import { SettingsStore } from "#settings/settingsStore";
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
    // Only the text is state: a batch of lines that changes nothing on screen (debug lines under the default
    // "info" level, a repeated line) leaves it equal, so React skips the render, and a render is a whole Ink frame.
    const [logText, setLogText] = useState("");
    // The count is only on screen in the Logs tab. Counting in a ref keeps the other tabs from re-rendering on
    // every batch (up to 10 a second while a download runs); the state is only updated while the count is shown.
    const logCountRef = useRef(0);
    const showCountRef = useRef(false);
    const [logCount, setLogCount] = useState(0);
    useEffect(() => {
        showCountRef.current = subTab === "logs";
        if (subTab === "logs") setLogCount(logCountRef.current);
    }, [subTab]);
    const [showStats, setShowStats] = useState(statsDisplay.get());
    const { fps, minFps, maxFps, renderMs } = useFps(showStats);

    useEffect(() => {
        const unsubscribe = inkTransport.subscribe((logs) => {
            if (logs.length === 0) return;
            logCountRef.current += logs.length;
            // The footer follows Settings → Logs → level like the Logs tab does (it used to show every debug line).
            const minLevel = LOG_LEVEL_ORDER[SettingsStore.getInstance().getAppSettings().logs.logLevel];
            for (let i = logs.length - 1; i >= 0; i--) {
                const log = logs[i] as LogMetadata;
                if (LOG_LEVEL_ORDER[log.level as LogLevel] < minLevel) continue;
                setLogText(`[${log.level?.toUpperCase() ?? "LOG"}] ${log.message}`);
                break;
            }
            if (showCountRef.current) setLogCount(logCountRef.current);
        });
        return unsubscribe;
    }, []);

    useEffect(() => statsDisplay.subscribe(setShowStats), []);

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
                        <Text color={fpsColor} bold>
                            {String(fps).padStart(2)}
                        </Text>
                        <Text color={theme.text.muted}> min </Text>
                        <Text color={theme.text.secondary}>{String(minFps).padStart(2)}</Text>
                        <Text color={theme.text.muted}> max </Text>
                        <Text color={theme.text.secondary}>{String(maxFps).padStart(2)}</Text>
                        <Text color={theme.text.muted}> </Text>
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
