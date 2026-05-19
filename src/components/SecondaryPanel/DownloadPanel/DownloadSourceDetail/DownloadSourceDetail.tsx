import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import * as path from "path";
import * as fs from "fs";
import { TrackDownloadSource } from "../../../../flows/musicDownloadFlow/types";
import { CompiledMetadata } from "../../../../flows/musicDownloadFlow/utils/compiledMetadata";
import { computeOutputFilename } from "../../../../flows/musicDownloadFlow/utils/computeOutputPath";
import { getInstance, PlayerStatus } from "../../../../utils/mpvPlayer";
import { formatBytes, formatDuration, formatDate, tagValue } from "../utils";
import { PlaybackBar } from "../PlaybackBar";
import { DiffView } from "./DiffView";
import { DetailRow } from "./DetailRow";
import { Hint } from "../../../Hint";
import { providerDisplayRegistry } from "../../../../base/providerDisplay";
import { useTheme } from "../../../../base/themeContext";

interface DownloadSourceDetailProps {
    source: TrackDownloadSource | null;
    savedSource: TrackDownloadSource | null;
    compiled: CompiledMetadata | null;
    outputDir: string;
    isDiffMode: boolean;
    diffKind: "source-switch" | "metadata-change";
    pendingSource: TrackDownloadSource | null;
    isActive: boolean;
    isSaving: boolean;
    width: number;
    height: number;
    onInnerFocusSwitch: () => void;
    onConfirmDiff: () => void;
    onCancelDiff: () => void;
    onRelocateFile: () => void;
    onSave: () => void;
}

const PRIORITY_TAGS = ["TITLE", "ARTIST", "ALBUM", "DATE", "TRACKNUMBER", "ISRC", "BPM", "KEY"];

function SectionDivider({ label, width }: { label: string; width: number }) {
    const theme = useTheme();
    const innerW = width - 2;
    const dashes = Math.max(0, innerW - label.length - 3);
    return (
        <Box paddingX={1} height={1} flexDirection="column">
            <Text color={theme.text.secondary}>
                {"── "}
                {label}
                {" " + "─".repeat(dashes)}
            </Text>
        </Box>
    );
}

export const DownloadSourceDetail: React.FC<DownloadSourceDetailProps> = ({
    source,
    savedSource,
    compiled,
    outputDir,
    isDiffMode,
    diffKind,
    pendingSource,
    isActive,
    isSaving,
    width,
    height,
    onInnerFocusSwitch,
    onConfirmDiff,
    onCancelDiff,
    onRelocateFile,
    onSave,
}) => {
    const theme = useTheme();
    const [isPlaying, setIsPlaying] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [positionMs, setPositionMs] = useState(0);
    const [durationMs, setDurationMs] = useState(0);

    const currentFilePath = source?.localFile?.path ?? null;

    useEffect(() => {
        const player = getInstance();

        function syncFromStatus(status: PlayerStatus) {
            const isThisFile = status.filePath === currentFilePath;
            setIsPlaying(isThisFile && status.isPlaying);
            setIsPaused(isThisFile && status.isPaused);
            if (isThisFile) {
                setPositionMs(status.positionMs);
                setDurationMs(status.durationMs);
            } else {
                setPositionMs(0);
                setDurationMs(0);
            }
        }

        const onProgress = (pos: number, dur: number) => {
            if (player.getStatus().filePath === currentFilePath) {
                setPositionMs(pos);
                setDurationMs(dur);
            }
        };
        const onStateChange = (status: PlayerStatus) => syncFromStatus(status);
        const onEnded = () => {
            setIsPlaying(false);
            setIsPaused(false);
            setPositionMs(0);
        };

        player.on("progress", onProgress);
        player.on("stateChange", onStateChange);
        player.on("ended", onEnded);
        syncFromStatus(player.getStatus());

        return () => {
            player.off("progress", onProgress);
            player.off("stateChange", onStateChange);
            player.off("ended", onEnded);
        };
    }, [currentFilePath]);

    useEffect(() => {
        return () => {
            const player = getInstance();
            if (player.getStatus().filePath === currentFilePath) {
                player.stop().catch(() => {});
            }
        };
    }, [currentFilePath]);

    useInput(
        (input, key) => {
            if (isDiffMode) {
                if (key.return) {
                    onConfirmDiff();
                    return;
                }
                if (key.escape) {
                    onCancelDiff();
                    return;
                }
                return;
            }

            if (key.leftArrow && !key.shift) {
                onInnerFocusSwitch();
                return;
            }

            if (input === " " && !key.ctrl && !key.meta) {
                const player = getInstance();
                const status = player.getStatus();
                if (status.filePath === currentFilePath && (status.isPlaying || status.isPaused)) {
                    player.togglePause().catch(() => {});
                } else if (currentFilePath && source?.localFile?.state === "found") {
                    player.play(currentFilePath).catch(() => {});
                }
                return;
            }

            if (key.leftArrow && key.shift) {
                const player = getInstance();
                const status = player.getStatus();
                if (status.filePath === currentFilePath && (status.isPlaying || status.isPaused)) {
                    player.seekMs(Math.max(0, status.positionMs - 5000)).catch(() => {});
                }
                return;
            }

            if (key.rightArrow && key.shift) {
                const player = getInstance();
                const status = player.getStatus();
                if (status.filePath === currentFilePath && (status.isPlaying || status.isPaused)) {
                    player.seekMs(Math.min(status.durationMs, status.positionMs + 5000)).catch(() => {});
                }
                return;
            }

            if (key.ctrl && input === "f") {
                if (source?.localFile?.state === "not_found") onRelocateFile();
                return;
            }

            if (key.return) {
                const canSave = source?.localFile?.state === "found" && !isSaving;
                if (canSave) onSave();
                return;
            }
        },
        { isActive }
    );

    if (isDiffMode && savedSource && pendingSource) {
        return (
            <DiffView
                savedSource={savedSource}
                pendingSource={pendingSource}
                compiled={compiled}
                outputDir={outputDir}
                diffKind={diffKind}
                isActive={isActive}
                width={width}
                height={height}
            />
        );
    }

    if (!source) return null;

    const isSaved = !!source.savedFile;
    const borderColor = isSaved ? theme.text.primary : theme.status.success;
    const headerColor = isSaved ? theme.text.primary : theme.status.success;

    const outputFileExists =
        !isSaved && compiled !== null && fs.existsSync(path.join(outputDir, computeOutputFilename(compiled)));

    const headerLabel = isSaved ? "FILE ON DISK" : "NEW FILE";
    const innerW = width - 2;
    const dashes = Math.max(0, innerW - headerLabel.length - 2);
    const leftD = Math.floor(dashes / 2);
    const rightD = dashes - leftD + 1;
    const borderLeft = `┌${"─".repeat(leftD)} `;
    const borderRight = ` ${"─".repeat(rightD)}┐`;

    const fileNotFound = source.localFile?.state === "not_found";
    const sourceDurationMs = source.fileInfo?.durationMs ?? source.track.duration ?? 0;
    const displayDurationMs = durationMs > 0 ? durationMs : sourceDurationMs;
    const filename = source.localFile ? `${source.localFile.name}.${source.localFile.extension}` : "—";
    const sizeText = source.fileInfo ? formatBytes(source.fileInfo.sizeBytes) : "—";
    const formatLabel = (source.fileInfo?.format ?? "flac").toUpperCase();
    const embeddedTags = source.fileInfo?.embeddedTags ?? {};
    const otherTagKeys = Object.keys(embeddedTags)
        .map((k) => k.toUpperCase())
        .filter((k) => !PRIORITY_TAGS.includes(k));
    const canPlay = source.localFile?.state === "found";

    const dlProvider = providerDisplayRegistry.get(source.provider);
    const metaPlatform = providerDisplayRegistry.get(source.track.apiProvider);
    const trackType = source.track.type
        ? source.track.type.charAt(0).toUpperCase() + source.track.type.slice(1)
        : "Track";
    const sourceParts = [dlProvider.label, metaPlatform.label, trackType, source.track.id].filter(Boolean);

    return (
        <Box flexDirection="column" width={width} height={height} overflow="hidden">
            <Box flexDirection="column" height={1} flexShrink={0} overflow="hidden">
                <Box flexDirection="row">
                    <Text color={borderColor}>{borderLeft}</Text>
                    <Text color={headerColor}>{headerLabel}</Text>
                    <Text color={borderColor}>{borderRight}</Text>
                </Box>
            </Box>

            <Box
                flexDirection="column"
                flexGrow={1}
                overflow="hidden"
                borderStyle="single"
                borderColor={borderColor}
                borderBackgroundColor={theme.ui.background}
                borderTop={false}
            >
                <Box flexDirection="column" flexGrow={1} overflow="hidden">
                    {outputFileExists && (
                        <Box paddingX={1} paddingBottom={1} flexShrink={0}>
                            <Text color={theme.status.warning} bold>
                                △ Warning: A file already exists! Please check before overwriting the file.
                            </Text>
                        </Box>
                    )}

                    {canPlay && (
                        <PlaybackBar
                            positionMs={positionMs}
                            durationMs={displayDurationMs}
                            width={innerW}
                            isPlaying={isPlaying}
                            isPaused={isPaused}
                        />
                    )}

                    <Box paddingX={1} paddingBottom={1} height={1} flexShrink={0} flexDirection="row" overflow="hidden">
                        <Text color={theme.text.secondary}>{"SOURCE  "}</Text>
                        {sourceParts.map((part, idx) => (
                            <React.Fragment key={idx}>
                                {idx > 0 && <Text color={theme.text.secondary}>{" > "}</Text>}
                                <Text color={dlProvider.color}>{part}</Text>
                            </React.Fragment>
                        ))}
                    </Box>

                    {fileNotFound ? (
                        <Box flexDirection="column" paddingX={1} paddingY={1}>
                            <Text color={theme.status.warning}>⚠ File not found</Text>
                            <Text color={theme.text.secondary} dimColor wrap="truncate-end">
                                Last known: {source.localFile?.path ?? "—"}
                            </Text>
                            <Box marginTop={1}>
                                <Text color={theme.text.active} bold>
                                    [Ctrl+F]
                                </Text>
                                <Text color={theme.text.hint}> Relocate file</Text>
                            </Box>
                        </Box>
                    ) : (
                        <Box flexDirection="column" flexShrink={0}>
                            {compiled && (
                                <>
                                    <DetailRow label="Title" value={compiled.trackName || "—"} />
                                    <DetailRow
                                        label="Artists"
                                        value={compiled.artists.map((a) => a.name).join(", ") || "—"}
                                    />
                                    {compiled.album && <DetailRow label="Album" value={compiled.album.albumName} />}
                                    {compiled.year != null && <DetailRow label="Year" value={String(compiled.year)} />}
                                    {compiled.bpm != null && <DetailRow label="BPM" value={String(compiled.bpm)} />}
                                    {compiled.key && <DetailRow label="Key" value={compiled.key} />}
                                    {compiled.genres && compiled.genres.length > 0 && (
                                        <DetailRow label="Genres" value={compiled.genres.join(", ")} />
                                    )}
                                </>
                            )}
                            <DetailRow label="File" value={filename} />
                            <DetailRow label="Format" value={formatLabel} />
                            <DetailRow label="Size" value={sizeText} />
                            <DetailRow label="Duration" value={formatDuration(sourceDurationMs)} />
                            {compiled && (
                                <DetailRow
                                    label="Output"
                                    value={path.join(outputDir, computeOutputFilename(compiled))}
                                    valueColor={theme.text.secondary}
                                />
                            )}
                        </Box>
                    )}

                    {!fileNotFound && (
                        <>
                            <Box height={1} flexDirection="column" />
                            <SectionDivider label="Embedded Tags" width={innerW} />
                            {PRIORITY_TAGS.map((tag) => (
                                <DetailRow key={tag} label={tag} value={tagValue(embeddedTags, tag)} />
                            ))}
                            {otherTagKeys.map((tag) => (
                                <DetailRow key={tag} label={tag} value={tagValue(embeddedTags, tag)} />
                            ))}
                        </>
                    )}

                    {source.savedFile && (
                        <Box flexDirection="column" overflow="hidden" marginTop={1}>
                            <SectionDivider label="Saved" width={innerW} />
                            <DetailRow label="Path" value={source.savedFile.path} />
                            <DetailRow label="Saved at" value={formatDate(source.savedFile.savedAt)} />
                        </Box>
                    )}
                </Box>

                <Box flexDirection="column" height={1} minHeight={1} overflow="hidden">
                    <Box flexDirection="row" paddingX={1} overflow="hidden" flexGrow={1}>
                        {isActive && canPlay && (
                            <Hint label={isPaused ? "Resume" : isPlaying ? "Pause" : " Play"} shortcut="Space" />
                        )}
                        {isActive && canPlay && (isPlaying || isPaused) && <Hint label="Seek 5s" shortcut="⇧←/⇧→" />}
                        {isActive && fileNotFound && <Hint label="Relocate" shortcut="Ctrl+F" />}
                        {isActive && canPlay && !isSaving && (
                            <Hint label={source?.savedFile ? "Update" : "Save"} shortcut="Enter" />
                        )}
                        {isActive && isSaving && <Hint label="Saving…" shortcut="" />}
                    </Box>
                </Box>
            </Box>
        </Box>
    );
};
