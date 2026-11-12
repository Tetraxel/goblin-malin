import React, { useRef } from "react";
import path from "path";
import { Box, Text, type DOMElement } from "ink";
import { useClickTarget, useHoverTarget } from "#base/mouse/useMouseTarget";
import { useTheme } from "#base/themeContext";
import { providerDisplayRegistry } from "#base/providerDisplay";
import { type TrackDownloadSource } from "#flows/musicDownloadFlow/types";
import { getSavedFileDisplay } from "#flows/musicDownloadFlow/utils/provenance";
import { formatBytes } from "#components/SecondaryPanel/DownloadPanel/utils";
import { PlaybackIndicator } from "#components/PlaybackIndicator";
import { revealInFileExplorer } from "#utils/revealInFileExplorer";

/** Lines the pinned block takes: its title, the file, the folder it is in, and a rule before the providers. */
export const SAVED_ROW_HEIGHT = 4;

const TITLE = " SAVED FILE ";
/** Columns before the title: the lead-in dashes. */
const TITLE_LEAD = "── ";

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
    /** The file is not on disk any more. */
    missing?: boolean;
    onSelect: () => void;
}

/**
 * The file this track was saved as, pinned above the providers. It stays in view however the lists below
 * scroll, so what is on disk can always be compared with the source under the cursor.
 */
export function SavedFileRow({ source, isFocused, isActive, width, playback, missing, onSelect }: SavedFileRowProps) {
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
    // A re-encoded file is not what `source.fileInfo` (the temporary download) describes: use what was written.
    const provenance = getSavedFileDisplay(source.fileInfo, saved.converted);
    const provenanceColor = provenance.tone === "warning" ? theme.status.warning : theme.status.success;
    const savedBytes = saved.converted?.sizeBytes ?? source.fileInfo?.sizeBytes;
    const sizeText = savedBytes !== undefined ? formatBytes(savedBytes) : "";

    const lineColor = theme.status.locked;
    const titleDashes = Math.max(0, width - 1 - TITLE_LEAD.length - TITLE.length - 1);

    return (
        <Box flexDirection="column" width={width} height={SAVED_ROW_HEIGHT} flexShrink={0} overflow="hidden">
            {/* The title sets this block apart from the download providers below it: it is a file in the library, not a candidate. */}
            <Box width={width} height={1} paddingLeft={1} flexShrink={0} overflow="hidden">
                <Text wrap="truncate-end">
                    <Text color={lineColor}>{TITLE_LEAD}</Text>
                    <Text color={lineColor} bold inverse>
                        {TITLE}
                    </Text>
                    <Text color={lineColor}>{" " + "─".repeat(titleDashes)}</Text>
                </Text>
            </Box>
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
                    <Text color={missing ? theme.status.warning : lineColor} bold>
                        {missing ? "△" : "●"}
                    </Text>
                </Box>
                {playback && (
                    <Box flexShrink={0} paddingRight={1}>
                        <PlaybackIndicator state={playback} />
                    </Box>
                )}
                <Box flexGrow={1} overflow="hidden">
                    <Text color={missing ? theme.status.warning : theme.text.primary} bold wrap="truncate-end">
                        {path.basename(saved.path)}
                    </Text>
                </Box>
                {missing ? (
                    <Box paddingLeft={1} paddingRight={1} flexShrink={0}>
                        <Text color={theme.status.warning} bold>
                            FILE NOT FOUND
                        </Text>
                    </Box>
                ) : (
                    <Box paddingLeft={1} flexShrink={0}>
                        <Text color={theme.text.secondary}>{"from "}</Text>
                        <Text color={display.color}>{display.acronym}</Text>
                    </Box>
                )}
                {!missing && provenance.badge !== "" && (
                    <Box minWidth={provenance.badge.length + 1} paddingLeft={1} flexShrink={0}>
                        <Text color={provenanceColor}>{provenance.badge}</Text>
                    </Box>
                )}
                {!missing && sizeText !== "" && (
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
            {/* Closes the block, so the providers below start under a line of their own. */}
            <Box width={width} height={1} paddingLeft={1} flexShrink={0} overflow="hidden">
                <Text color={lineColor} dimColor wrap="truncate-end">
                    {"─".repeat(Math.max(0, width - 1))}
                </Text>
            </Box>
        </Box>
    );
}
