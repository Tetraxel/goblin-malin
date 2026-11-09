import React, { useRef } from "react";
import { Box, Text, type DOMElement } from "ink";
import { useClickTarget } from "#base/mouse/useMouseTarget";
import { useTheme } from "#base/themeContext";
import { type TrackDownloadSource } from "#flows/musicDownloadFlow/types";
import { getProvenanceDisplay } from "#flows/musicDownloadFlow/utils/provenance";
import { formatAnnouncedAudio, formatBytes } from "#components/SecondaryPanel/DownloadPanel/utils";
import { PlaybackIndicator } from "#components/PlaybackIndicator";
import { StateBadge } from "../StateBadge";

interface SourceFileRowProps {
    source: TrackDownloadSource;
    sourceIndex: number;
    isSelected: boolean;
    isActive: boolean;
    width: number;
    /** Set when the player is on this source's file. */
    playback?: "playing" | "paused";
    onSelect: (sourceIndex: number) => void;
}

export function SourceFileRow({
    source,
    sourceIndex,
    isSelected,
    isActive,
    width,
    playback,
    onSelect,
}: SourceFileRowProps) {
    const theme = useTheme();
    const rowRef = useRef<DOMElement>(null);
    useClickTarget(rowRef, () => onSelect(sourceIndex));
    const bg =
        isSelected && isActive
            ? theme.ui.rowBackground.regular.cellActive
            : isSelected
              ? theme.ui.rowBackground.regular.highlighted
              : undefined;

    const localFile = source.localFile;
    const filename = localFile ? `${localFile.name}.${localFile.extension}` : null;
    const candidate = source.candidate;
    const sizeBytes = source.fileInfo?.sizeBytes ?? candidate?.sizeBytes;
    const sizeText = sizeBytes != null ? formatBytes(sizeBytes) : "";
    // Until the file is here, the quality its provider announced (the real one replaces it once probed).
    const announcedText = localFile ? "" : formatAnnouncedAudio(candidate?.audio);
    const provenance = getProvenanceDisplay(source.fileInfo);
    const provenanceColor =
        provenance.tone === "success"
            ? theme.status.success
            : provenance.tone === "warning"
              ? theme.status.warning
              : theme.text.secondary;

    // While the file isn't downloaded yet there's no filename — show the anticipated
    // track name (dimmed) so the row is recognizable during download. The state badge
    // on the right communicates progress, so we don't repeat it on the left.
    const artist = source.track.artists?.[0]?.name ?? "";
    // A listed remote file (not downloaded yet) is recognized by its own name instead.
    const trackLabel = candidate?.name ?? (artist ? `${artist} - ${source.track.trackName}` : source.track.trackName);

    return (
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
                <Text color={theme.ui.focusIndicator}>{isSelected && isActive ? "☛ " : "  "}</Text>
            </Box>
            <Box width={2} minWidth={2} flexShrink={0}>
                {source.isRejected ? (
                    <Text color={theme.status.error}>✘ </Text>
                ) : source.selected ? (
                    <Text color={theme.ui.selection}>✓ </Text>
                ) : (
                    <Text>{"  "}</Text>
                )}
            </Box>
            <Box minWidth={3} flexShrink={0}>
                <Text color={theme.text.secondary} dimColor={source.isRejected} strikethrough={source.isRejected}>
                    {`${sourceIndex + 1}. `}
                </Text>
            </Box>
            {playback && (
                <Box flexShrink={0} paddingRight={1}>
                    <PlaybackIndicator state={playback} />
                </Box>
            )}
            <Box flexGrow={1} overflow="hidden">
                {filename ? (
                    <Text
                        color={theme.text.primary}
                        wrap="truncate-end"
                        dimColor={source.isRejected}
                        strikethrough={source.isRejected}
                    >
                        {filename}
                    </Text>
                ) : (
                    <Text
                        color={source.state === "failed" ? theme.status.error : theme.text.secondary}
                        dimColor
                        strikethrough={source.isRejected}
                        wrap="truncate-end"
                    >
                        {trackLabel}
                    </Text>
                )}
            </Box>
            {source.providerDetail && (
                <Box maxWidth={20} paddingLeft={1} flexShrink={0} overflow="hidden">
                    <Text color={theme.text.secondary} dimColor strikethrough={source.isRejected} wrap="truncate-end">
                        {`${source.providerDetail}`}
                    </Text>
                </Box>
            )}
            {candidate?.note && !localFile && (
                <Box paddingLeft={1} flexShrink={0}>
                    <Text color={theme.status.warning} dimColor strikethrough={source.isRejected}>
                        {candidate.note}
                    </Text>
                </Box>
            )}
            {provenance.badge !== "" && (
                <Box minWidth={provenance.badge.length + 1} paddingLeft={1} flexShrink={0}>
                    <Text color={provenanceColor} dimColor={source.isRejected} strikethrough={source.isRejected}>
                        {provenance.badge}
                    </Text>
                </Box>
            )}
            {announcedText !== "" && (
                <Box paddingLeft={1} flexShrink={0}>
                    <Text color={theme.text.secondary} dimColor strikethrough={source.isRejected}>
                        {announcedText}
                    </Text>
                </Box>
            )}
            {sizeText !== "" && (
                <Box minWidth={sizeText.length + 1} paddingLeft={1} flexShrink={0}>
                    <Text color={theme.text.secondary} dimColor={source.isRejected} strikethrough={source.isRejected}>
                        {sizeText}
                    </Text>
                </Box>
            )}
            <Box paddingLeft={1} paddingRight={1} flexShrink={0}>
                <StateBadge source={source} />
            </Box>
        </Box>
    );
}
