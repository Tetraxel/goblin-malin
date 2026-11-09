import React, { useRef } from "react";
import path from "path";
import { Box, Text, type DOMElement } from "ink";
import { useClickTarget, useHoverTarget } from "#base/mouse/useMouseTarget";
import { useTheme } from "#base/themeContext";
import { providerDisplayRegistry } from "#base/providerDisplay";
import { type TrackDownloadSource } from "#flows/musicDownloadFlow/types";
import { getProvenanceDisplay } from "#flows/musicDownloadFlow/utils/provenance";
import { formatBytes } from "#components/SecondaryPanel/DownloadPanel/utils";
import { PlaybackIndicator } from "#components/PlaybackIndicator";
import { revealInFileExplorer } from "#utils/revealInFileExplorer";

/** Lines the pinned row takes: the file, the folder it is in, and a blank line before the providers. */
export const SAVED_ROW_HEIGHT = 3;

interface SavedFileRowProps {
    /** The source whose file was saved. */
    source: TrackDownloadSource;
    /** The cursor is on this row (and not on one of the provider rows below). */
    isFocused: boolean;
    /** The list has keyboard focus. */
    isActive: boolean;
    width: number;
    /** Set when the player is on this file. */
    playback?: "playing" | "paused";
    onSelect: () => void;
}

/**
 * The file this track was saved as, pinned above the providers. It stays in view however the lists below
 * scroll, so what is on disk can always be compared with the source under the cursor.
 */
export function SavedFileRow({ source, isFocused, isActive, width, playback, onSelect }: SavedFileRowProps) {
    const theme = useTheme();
    const rowRef = useRef<DOMElement>(null);
    useClickTarget(rowRef, onSelect);
    const folderRef = useRef<DOMElement>(null);
    const savedPath = source.savedFile?.path;
    useClickTarget(folderRef, () => {
        if (savedPath) revealInFileExplorer(savedPath);
    });
    const isFolderHovered = useHoverTarget(folderRef);
    const bg = isFocused
        ? isActive
            ? theme.ui.rowBackground.regular.cellActive
            : theme.ui.rowBackground.regular.highlighted
        : undefined;

    const saved = source.savedFile;
    if (!saved) return null;

    const display = providerDisplayRegistry.get(source.provider);
    const provenance = getProvenanceDisplay(source.fileInfo);
    const provenanceColor = provenance.tone === "warning" ? theme.status.warning : theme.status.success;
    const sizeText = source.fileInfo ? formatBytes(source.fileInfo.sizeBytes) : "";

    return (
        <Box flexDirection="column" width={width} height={SAVED_ROW_HEIGHT} flexShrink={0} overflow="hidden">
            <Box
                ref={rowRef}
                flexDirection="row"
                width={width}
                minWidth={width}
                height={1}
                flexShrink={0}
                overflow="hidden"
                backgroundColor={bg}
            >
                <Box width={3} minWidth={3} flexShrink={0}>
                    <Text color={theme.ui.focusIndicator}>{isFocused && isActive ? "☛ " : "  "}</Text>
                </Box>
                <Box flexShrink={0} paddingRight={1}>
                    <Text color={theme.status.locked} bold>
                        ● SAVED
                    </Text>
                </Box>
                {playback && (
                    <Box flexShrink={0} paddingRight={1}>
                        <PlaybackIndicator state={playback} />
                    </Box>
                )}
                <Box flexGrow={1} overflow="hidden">
                    <Text color={theme.text.primary} wrap="truncate-end">
                        {path.basename(saved.path)}
                    </Text>
                </Box>
                <Box paddingLeft={1} flexShrink={0}>
                    <Text color={theme.text.secondary}>{"from "}</Text>
                    <Text color={display.color}>{display.acronym}</Text>
                </Box>
                {provenance.badge !== "" && (
                    <Box minWidth={provenance.badge.length + 1} paddingLeft={1} flexShrink={0}>
                        <Text color={provenanceColor}>{provenance.badge}</Text>
                    </Box>
                )}
                {sizeText !== "" && (
                    <Box minWidth={sizeText.length + 1} paddingLeft={1} paddingRight={1} flexShrink={0}>
                        <Text color={theme.text.secondary}>{sizeText}</Text>
                    </Box>
                )}
            </Box>
            <Box marginLeft={4} flexDirection="row" overflow="hidden" flexShrink={0}>
                <Box flexShrink={0} paddingRight={1}>
                    <Text color={theme.text.secondary}>{"└─"}</Text>
                </Box>
                {/* Only the path itself is the click target: a click on it shows the file in the file explorer. */}
                <Box ref={folderRef} flexShrink={1} overflow="hidden">
                    <Text
                        color={isFolderHovered ? theme.text.primary : theme.text.secondary}
                        dimColor={!isFolderHovered}
                        underline={isFolderHovered}
                        wrap="truncate-start"
                    >
                        {saved.path}
                    </Text>
                </Box>
            </Box>
        </Box>
    );
}
