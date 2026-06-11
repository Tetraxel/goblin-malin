import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Text } from "ink";
import { createWriteStream } from "fs";
import os from "os";
import path from "path";
import open from "open";
import { useShortcuts } from "#hooks/useShortcuts";
import { useFocusContext } from "#contexts/FocusContext";
import { useTheme } from "#base/themeContext";
import { Hint } from "../Hint";
import { APP_VERSION } from "../../constants";

interface UpdateModalProps {
    latestVersion: string;
    releaseUrl: string;
    downloadUrl: string | null;
    terminalHeight: number;
    terminalWidth: number;
}

type DownloadState =
    | { status: "idle" }
    | { status: "downloading"; progress: number; filename: string }
    | { status: "extracting"; filename: string }
    | { status: "installing"; filename: string }
    | { status: "done"; destPath: string }
    | { status: "error"; message: string };

const STEPS = ["Downloading", "Extracting", "Installing"] as const;

function stepIndex(state: DownloadState): number {
    if (state.status === "downloading") return 0;
    if (state.status === "extracting") return 1;
    if (state.status === "installing") return 2;
    return -1;
}

function filenameFromUrl(url: string): string {
    try {
        return decodeURIComponent(new URL(url).pathname.split("/").pop() ?? url);
    } catch {
        return url.split("/").pop() ?? url;
    }
}

const OPTIONS = ["Update now", "Open release page"] as const;

function renderBar(percent: number, width: number): string {
    const filled = Math.round((percent / 100) * width);
    return "█".repeat(filled) + "░".repeat(width - filled);
}

export const UpdateModal: React.FC<UpdateModalProps> = ({
    latestVersion,
    releaseUrl,
    downloadUrl,
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

    const [selectedIndex, setSelectedIndex] = useState(0);
    const [downloadState, setDownloadState] = useState<DownloadState>({ status: "idle" });

    const handleClose = useCallback(() => {
        switchBack();
    }, [switchBack]);

    const handleConfirm = useCallback(() => {
        if (downloadState.status === "done" || downloadState.status === "error") {
            switchBack();
            return;
        }
        if (
            downloadState.status === "downloading" ||
            downloadState.status === "extracting" ||
            downloadState.status === "installing"
        )
            return;

        if (selectedIndex === 1) {
            void open(releaseUrl);
            switchBack();
            return;
        }

        // "Update now"
        if (!downloadUrl) {
            setDownloadState({ status: "error", message: "No executable asset found in this release." });
            return;
        }

        const filename = filenameFromUrl(downloadUrl);
        setDownloadState({ status: "downloading", progress: 0, filename });

        const destPath = path.join(os.homedir(), "Downloads", filename);
        const url = downloadUrl;

        void (async () => {
            try {
                const res = await fetch(url, {
                    headers: { "User-Agent": "goblin-malin-updater" },
                    signal: AbortSignal.timeout(300_000),
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                if (!res.body) throw new Error("No response body");

                const total = parseInt(res.headers.get("content-length") ?? "0", 10);
                let received = 0;

                const writer = createWriteStream(destPath);
                const reader = res.body.getReader();

                const writeChunk = (chunk: Uint8Array) =>
                    new Promise<void>((resolve, reject) =>
                        writer.write(chunk, (err) => (err ? reject(err) : resolve()))
                    );

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    await writeChunk(value);
                    received += value.byteLength;
                    if (mountedRef.current && total > 0) {
                        setDownloadState({
                            status: "downloading",
                            progress: Math.round((received / total) * 100),
                            filename,
                        });
                    }
                }

                await new Promise<void>((resolve, reject) =>
                    writer.end((err?: Error | null) => (err ? reject(err) : resolve()))
                );

                if (mountedRef.current) setDownloadState({ status: "done", destPath });
            } catch (e) {
                if (mountedRef.current)
                    setDownloadState({ status: "error", message: e instanceof Error ? e.message : String(e) });
            }
        })();
    }, [downloadState.status, selectedIndex, releaseUrl, downloadUrl, switchBack]);

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
                    if (downloadState.status === "idle") setSelectedIndex(0);
                },
            },
            {
                id: "updateModal.down",
                defaultShortcut: { key: "downArrow" },
                label: "",
                handler: () => {
                    if (downloadState.status === "idle") setSelectedIndex(1);
                },
            },
        ],
    });

    if (!isActive) return null;

    const modalWidth = Math.min(62, terminalWidth - 8);
    const barWidth = modalWidth - 6;
    const activeStepIdx = stepIndex(downloadState);
    const isInProgress =
        downloadState.status === "downloading" ||
        downloadState.status === "extracting" ||
        downloadState.status === "installing";

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

                {downloadState.status === "idle" && (
                    <Box flexDirection="column" marginTop={1}>
                        {OPTIONS.map((label, i) => (
                            <Box key={label} flexDirection="row">
                                <Text color={selectedIndex === i ? theme.ui.focusIndicator : theme.text.primary}>
                                    {selectedIndex === i ? "☛ " : "  "}
                                    {label}
                                </Text>
                            </Box>
                        ))}
                    </Box>
                )}

                {isInProgress && (
                    <Box flexDirection="column" marginTop={1}>
                        <Box flexDirection="row" flexShrink={0}>
                            {STEPS.map((step, i) => {
                                const isDone = i < activeStepIdx;
                                const isCurrent = i === activeStepIdx;
                                const icon = isDone ? "✓" : isCurrent ? "●" : "○";
                                const color = isDone
                                    ? theme.status.success
                                    : isCurrent
                                      ? theme.ui.focusIndicator
                                      : theme.text.muted;
                                return (
                                    <Box key={step} flexDirection="row" flexShrink={0}>
                                        <Text color={color}>
                                            {icon} {step}
                                        </Text>
                                        {i < STEPS.length - 1 && <Text dimColor>  ─  </Text>}
                                    </Box>
                                );
                            })}
                        </Box>
                        {"filename" in downloadState && (
                            <Text color={theme.text.muted} wrap="truncate">
                                {downloadState.filename}
                            </Text>
                        )}
                        {downloadState.status === "downloading" && (
                            <>
                                <Box flexDirection="row" marginTop={1} flexShrink={0}>
                                    <Text color={theme.ui.focusIndicator}>{renderBar(downloadState.progress, barWidth)}</Text>
                                </Box>
                                <Text dimColor>{downloadState.progress}%</Text>
                            </>
                        )}
                        {downloadState.status !== "downloading" && (
                            <Box flexDirection="row" marginTop={1} flexShrink={0}>
                                <Text color={theme.status.success}>{renderBar(100, barWidth)}</Text>
                            </Box>
                        )}
                    </Box>
                )}

                {downloadState.status === "done" && (
                    <Box flexDirection="column" marginTop={1}>
                        <Text color={theme.status.success}>Downloaded successfully.</Text>
                        <Text color={theme.text.muted} wrap="truncate">
                            {downloadState.destPath}
                        </Text>
                        <Text dimColor>Replace your current .exe to update, then restart.</Text>
                    </Box>
                )}

                {downloadState.status === "error" && (
                    <Box flexDirection="column" marginTop={1}>
                        <Text color={theme.status.error}>Download failed: {downloadState.message}</Text>
                    </Box>
                )}

                <Box marginTop={1} flexDirection="row">
                    {downloadState.status === "idle" && (
                        <>
                            <Hint label="Select" shortcut="↑↓" />
                            <Hint label="Confirm" shortcut="Enter" />
                            <Hint label="Dismiss" shortcut="Esc" />
                        </>
                    )}
                    {isInProgress && <Text dimColor>Please wait...</Text>}
                    {(downloadState.status === "done" || downloadState.status === "error") && (
                        <Hint label="Close" shortcut="Esc" />
                    )}
                </Box>
            </Box>
        </Box>
    );
};
