import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Text } from "ink";
import { spawn, exec } from "child_process";
import open from "open";
import { useShortcuts } from "#hooks/useShortcuts";
import { useFocusContext } from "#contexts/FocusContext";
import { useTheme } from "#base/themeContext";
import { Hint } from "../Hint";
import { APP_VERSION } from "../../constants";
import { IS_SEA, getInstaller, getUpdateCommand } from "../../updater/installSource";

interface UpdateModalProps {
    latestVersion: string;
    releaseUrl: string;
    terminalHeight: number;
    terminalWidth: number;
}

type PkgUpdateState = "idle" | "running" | "done" | "error";

const installer = getInstaller();
const updateCommand = getUpdateCommand();

export const UpdateModal: React.FC<UpdateModalProps> = ({
    latestVersion,
    releaseUrl,
    terminalHeight,
    terminalWidth,
}) => {
    const theme = useTheme();
    const { focusState, switchBack } = useFocusContext();
    const isActive = focusState.activeWindow === "updateModal";
    const mountedRef = useRef(true);

    useEffect(() => {
        return () => {
            mountedRef.current = false;
        };
    }, []);

    // npm: 0 = run update command, 1 = open release page
    // SEA: single option (open release page), selectedIndex unused
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [pkgStatus, setPkgStatus] = useState<PkgUpdateState>("idle");
    const [pkgOutput, setPkgOutput] = useState<string[]>([]);

    const handleClose = useCallback(() => {
        switchBack();
    }, [switchBack]);

    const handleConfirm = useCallback(() => {
        if (IS_SEA) {
            // open package is pre-bundled as a shim in SEA builds and may fail silently;
            // use the platform's native command directly instead.
            const cmd =
                process.platform === "win32"
                    ? `start "" "${releaseUrl}"`
                    : process.platform === "darwin"
                      ? `open "${releaseUrl}"`
                      : `xdg-open "${releaseUrl}"`;
            exec(cmd);
            switchBack();
            return;
        }

        if (pkgStatus === "done") {
            process.exit(0);
        }
        if (pkgStatus === "error") {
            switchBack();
            return;
        }
        if (pkgStatus === "running") return;

        if (selectedIndex === 1) {
            void open(releaseUrl);
            switchBack();
            return;
        }

        // Run the package manager update command
        setPkgStatus("running");
        const [bin, ...args] = updateCommand.split(" ");
        const proc = spawn(bin, args, { stdio: "pipe", shell: true });

        const addLines = (chunk: Buffer) => {
            const lines = chunk.toString().split("\n").filter(Boolean);
            setPkgOutput((prev) => [...prev, ...lines].slice(-12));
        };
        proc.stdout?.on("data", addLines);
        proc.stderr?.on("data", addLines);

        proc.on("exit", (code) => {
            if (!mountedRef.current) return;
            setPkgStatus(code === 0 ? "done" : "error");
        });

        proc.on("error", (err) => {
            if (!mountedRef.current) return;
            setPkgOutput((prev) => [...prev, err.message]);
            setPkgStatus("error");
        });
    }, [pkgStatus, selectedIndex, releaseUrl, switchBack]);

    useShortcuts({
        id: "updateModal",
        isActive,
        exclusive: true,
        priority: 300,
        shortcuts: [
            {
                id: "updateModal.close",
                defaultShortcut: { key: "escape" },
                label: "Dismiss",
                handler: handleClose,
            },
            {
                id: "updateModal.confirm",
                defaultShortcut: { key: "return" },
                label: "Confirm",
                handler: handleConfirm,
            },
            {
                id: "updateModal.up",
                defaultShortcut: { key: "upArrow" },
                label: "",
                handler: () => {
                    if (!IS_SEA && pkgStatus === "idle") setSelectedIndex(0);
                },
            },
            {
                id: "updateModal.down",
                defaultShortcut: { key: "downArrow" },
                label: "",
                handler: () => {
                    if (!IS_SEA && pkgStatus === "idle") setSelectedIndex(1);
                },
            },
        ],
    });

    if (!isActive) return null;

    const modalWidth = Math.min(62, terminalWidth - 8);
    // SEA has no progress states — always "idle" from the modal's perspective
    const isIdle = IS_SEA || pkgStatus === "idle";
    const isInProgress = !IS_SEA && pkgStatus === "running";

    return (
        <Box
            position="absolute"
            width="100%"
            height={terminalHeight}
            flexDirection="column"
            justifyContent="center"
            alignItems="center"
        >
            <Box
                flexDirection="column"
                borderStyle="round"
                borderColor={theme.status.success}
                paddingX={2}
                paddingY={1}
                width={modalWidth}
                backgroundColor={theme.ui.background}
            >
                <Text bold color={theme.status.success}>
                    Update Available
                </Text>

                <Box flexDirection="column" marginTop={1}>
                    <Box flexDirection="row">
                        <Text color={theme.text.muted}>Current version </Text>
                        <Text>{APP_VERSION}</Text>
                    </Box>
                    <Box flexDirection="row">
                        <Text color={theme.text.muted}>New version </Text>
                        <Text bold color={theme.status.success}>
                            {latestVersion}
                        </Text>
                    </Box>
                </Box>

                {isIdle && (
                    <Box flexDirection="column" marginTop={1}>
                        {IS_SEA ? (
                            <Box flexDirection="row" flexShrink={0}>
                                <Text color={theme.ui.focusIndicator}>☛ Open release page</Text>
                            </Box>
                        ) : (
                            <>
                                <Box flexDirection="row" flexShrink={0}>
                                    <Text color={selectedIndex === 0 ? theme.ui.focusIndicator : theme.text.primary}>
                                        {selectedIndex === 0 ? "☛ " : "  "}
                                        {"Update with "}
                                    </Text>
                                    <Text
                                        color={selectedIndex === 0 ? theme.ui.focusIndicator : theme.action.primary}
                                        bold
                                    >
                                        {updateCommand}
                                    </Text>
                                </Box>
                                <Box flexDirection="row" flexShrink={0}>
                                    <Text color={selectedIndex === 1 ? theme.ui.focusIndicator : theme.text.primary}>
                                        {selectedIndex === 1 ? "☛ " : "  "}
                                        Open release page
                                    </Text>
                                </Box>
                            </>
                        )}
                    </Box>
                )}

                {/* npm: running */}
                {!IS_SEA && pkgStatus === "running" && (
                    <Box flexDirection="column" marginTop={1}>
                        <Text color={theme.ui.focusIndicator}>Updating via {installer}...</Text>
                        {pkgOutput.map((line, i) => (
                            <Text key={i} dimColor wrap="truncate">
                                {line}
                            </Text>
                        ))}
                    </Box>
                )}

                {/* npm: done */}
                {!IS_SEA && pkgStatus === "done" && (
                    <Box flexDirection="column" marginTop={1}>
                        <Text color={theme.status.success}>Updated successfully.</Text>
                        <Text dimColor>Restart to use v{latestVersion}.</Text>
                    </Box>
                )}

                {/* npm: error */}
                {!IS_SEA && pkgStatus === "error" && (
                    <Box flexDirection="column" marginTop={1}>
                        <Text color={theme.status.error}>Update failed.</Text>
                        {pkgOutput.slice(-3).map((line, i) => (
                            <Text key={i} color={theme.text.muted} wrap="truncate">
                                {line}
                            </Text>
                        ))}
                    </Box>
                )}

                <Box marginTop={1} flexDirection="row">
                    {isIdle && (
                        <>
                            {!IS_SEA && <Hint label="Select" shortcut="↑↓" />}
                            <Hint label="Confirm" shortcut="Enter" />
                            <Hint label="Dismiss" shortcut="Esc" />
                        </>
                    )}
                    {isInProgress && <Text dimColor>Please wait...</Text>}
                    {!isIdle && !isInProgress && (
                        <>
                            {pkgStatus === "done" && <Hint label="Restart" shortcut="Enter" />}
                            <Hint label="Close" shortcut="Esc" />
                        </>
                    )}
                </Box>
            </Box>
        </Box>
    );
};
