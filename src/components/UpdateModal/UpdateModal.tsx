import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Text } from "ink";
import { spawn } from "child_process";
import { useShortcuts } from "#hooks/useShortcuts";
import { useFocusActions, useFocusChrome } from "#contexts/FocusContext";
import { useTheme } from "#base/themeContext";
import { Hint } from "../Hint";
import { APP_VERSION } from "#constants";
import { getInstaller, getUpdateArgv, getUpdateCommand } from "#updater/installSource";
import { globalLogger } from "#base/logger/logger";
import { exitApp } from "#utils/exitApp";
import { openUrl } from "#utils/openUrl";
import { killProcessTree } from "#utils/killProcessTree";
import { createLineSplitter } from "#utils/lineSplitter";

interface UpdateModalProps {
    latestVersion: string;
    releaseUrl: string;
    terminalHeight: number;
    terminalWidth: number;
}

type PkgUpdateState = "idle" | "running" | "done" | "error";

/** A package manager that has not finished after this long is stuck (a lock, a prompt, no network): it is stopped. */
const UPDATE_TIMEOUT_MS = 10 * 60_000;

const installer = getInstaller();

export const UpdateModal: React.FC<UpdateModalProps> = ({
    latestVersion,
    releaseUrl,
    terminalHeight,
    terminalWidth,
}) => {
    const updateCommand = getUpdateCommand(latestVersion);
    const theme = useTheme();
    const { switchBack } = useFocusActions();
    const { activeWindow } = useFocusChrome();
    const isActive = activeWindow === "updateModal";
    const mountedRef = useRef(true);

    useEffect(() => {
        return () => {
            mountedRef.current = false;
        };
    }, []);

    // 0 = run update command, 1 = open release page
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [pkgStatus, setPkgStatus] = useState<PkgUpdateState>("idle");
    const [pkgOutput, setPkgOutput] = useState<string[]>([]);

    // While the package manager runs the window may be closed: the install is not tied to it (it is never killed on
    // close, since a cut install can break the app), and the window, always mounted, shows how it ended when reopened.
    const handleClose = useCallback(() => switchBack(), [switchBack]);

    const handleConfirm = useCallback(() => {
        if (pkgStatus === "done") {
            // Through the normal close, so the pending session is saved and the terminal is restored.
            exitApp();
            return;
        }
        if (pkgStatus === "error") {
            switchBack();
            return;
        }
        if (pkgStatus === "running") return;

        if (selectedIndex === 1) {
            // Only http(s) links, and never through a shell (the address came from the network).
            openUrl(releaseUrl);
            switchBack();
            return;
        }

        // Run the package manager update command
        setPkgStatus("running");
        globalLogger.info(`[updater] running: ${updateCommand}`);
        const { bin, args } = getUpdateArgv(latestVersion);
        // Windows package managers are .cmd shims, which Node refuses to spawn without a shell (EINVAL).
        // Safe there because every argument is a constant or a version validated by getUpdateArgv.
        const proc = spawn(bin, args, { stdio: "pipe", shell: process.platform === "win32" });

        // Deliberately NOT registered for the exit clean-up: the window refuses to close while this runs because a cut
        // install can leave the global package half written, and killing it when the app exits would do just that.
        // Left alone, the package manager finishes the install by itself. Only the time limit below ends it.
        const timeout = setTimeout(() => {
            globalLogger.error(`[updater] no end after ${UPDATE_TIMEOUT_MS / 60_000} minutes: stopping it`);
            killProcessTree(proc);
        }, UPDATE_TIMEOUT_MS);

        const addLine = (line: string) => {
            globalLogger.info(`[updater] ${line}`);
            if (mountedRef.current) setPkgOutput((prev) => [...prev, line].slice(-20));
        };
        // One splitter per stream: each keeps its own unfinished line and split characters.
        const out = createLineSplitter(addLine);
        const err = createLineSplitter(addLine);
        proc.stdout?.on("data", out.write);
        proc.stderr?.on("data", err.write);

        proc.on("close", () => {
            out.end();
            err.end();
        });
        proc.on("exit", (code) => {
            clearTimeout(timeout);
            if (!mountedRef.current) return;
            if (code === 0) {
                globalLogger.info(`[updater] success`);
                setPkgStatus("done");
            } else {
                globalLogger.error(`[updater] failed with exit code ${code}`);
                setPkgStatus("error");
            }
        });

        proc.on("error", (error) => {
            clearTimeout(timeout);
            if (!mountedRef.current) return;
            globalLogger.error(`[updater] spawn error: ${error.message}`);
            setPkgOutput((prev) => [...prev, error.message]);
            setPkgStatus("error");
        });
    }, [pkgStatus, selectedIndex, releaseUrl, latestVersion, switchBack, updateCommand]);

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
                    if (pkgStatus === "idle") setSelectedIndex(0);
                },
            },
            {
                id: "updateModal.down",
                defaultShortcut: { key: "downArrow" },
                label: "",
                handler: () => {
                    if (pkgStatus === "idle") setSelectedIndex(1);
                },
            },
        ],
    });

    if (!isActive) return null;

    const modalWidth = Math.min(100, terminalWidth - 4);
    const isIdle = pkgStatus === "idle";
    const isInProgress = pkgStatus === "running";

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
                        <Box flexDirection="row" flexShrink={0}>
                            <Text color={selectedIndex === 0 ? theme.ui.focusIndicator : theme.text.primary}>
                                {selectedIndex === 0 ? "☛ " : "  "}
                                {"Update with "}
                            </Text>
                            <Text
                                color={selectedIndex === 0 ? theme.ui.focusIndicator : theme.action.primary}
                                underline={selectedIndex === 0}
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
                    </Box>
                )}

                {pkgStatus === "running" && (
                    <Box flexDirection="column" marginTop={1}>
                        <Text color={theme.ui.focusIndicator}>Updating via {installer}...</Text>
                        {pkgOutput.map((line, i) => (
                            <Text key={i} dimColor>
                                {line}
                            </Text>
                        ))}
                    </Box>
                )}

                {pkgStatus === "done" && (
                    <Box flexDirection="column" marginTop={1}>
                        <Text color={theme.status.success}>Updated successfully.</Text>
                        <Text dimColor>Restart to use v{latestVersion}.</Text>
                    </Box>
                )}

                {pkgStatus === "error" && (
                    <Box flexDirection="column" marginTop={1}>
                        <Text color={theme.status.error}>Update failed.</Text>
                        {pkgOutput.map((line, i) => (
                            <Text key={i} color={theme.text.muted}>
                                {line}
                            </Text>
                        ))}
                    </Box>
                )}

                <Box marginTop={1} flexDirection="row">
                    {isIdle && (
                        <>
                            <Hint label="Select" shortcutIds={["updateModal.up", "updateModal.down"]} />
                            <Hint label="Confirm" shortcutId="updateModal.confirm" />
                            <Hint label="Dismiss" shortcutId="updateModal.close" />
                        </>
                    )}
                    {isInProgress && (
                        <>
                            <Text dimColor>The update goes on if you close this window. </Text>
                            <Hint label="Close" shortcutId="updateModal.close" />
                        </>
                    )}
                    {!isIdle && !isInProgress && (
                        <>
                            {pkgStatus === "done" && <Hint label="Exit" shortcutId="updateModal.confirm" />}
                            <Hint label="Close" shortcutId="updateModal.close" />
                        </>
                    )}
                </Box>
            </Box>
        </Box>
    );
};
