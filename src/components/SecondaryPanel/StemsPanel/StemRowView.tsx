import React, { useRef } from "react";
import path from "path";
import { Box, Text, type DOMElement } from "ink";
import { useClickTarget } from "#base/mouse/useMouseTarget";
import { useTheme } from "#base/themeContext";
import { PlaybackIndicator } from "#components/PlaybackIndicator";
import { useFileExists } from "#hooks/useFileExists";
import { type SavedStem, type StemFile, type StemRun } from "#flows/musicDownloadFlow/types";
import { stemKindRegistry } from "#flows/musicDownloadFlow/stems/stemKinds";
import { describeStemRun } from "#flows/musicDownloadFlow/stems/stemFiles";
import { formatBytes, formatDate } from "../DownloadPanel/utils";
import { ProgressLine } from "./ProgressLine";

/** The columns the stem's name takes, so the states line up under each other. */
const KIND_WIDTH = 13;

type RowFrameProps = {
    isFocused: boolean;
    isActive: boolean;
    onClick: () => void;
    indent?: number;
    children: React.ReactNode;
};

function RowFrame({ isFocused, isActive, onClick, indent = 0, children }: RowFrameProps) {
    const theme = useTheme();
    const ref = useRef<DOMElement>(null);
    useClickTarget(ref, onClick);
    const bg = isFocused
        ? isActive
            ? theme.ui.rowBackground.regular.cellActive
            : theme.ui.rowBackground.regular.highlighted
        : undefined;
    return (
        <Box ref={ref} flexDirection="row" height={1} flexShrink={0} overflow="hidden" backgroundColor={bg}>
            <Box flexShrink={0} width={2}>
                <Text color={theme.action.primary}>{isFocused ? "›" : " "}</Text>
            </Box>
            {indent > 0 ? <Box flexShrink={0} width={indent} /> : null}
            {children}
        </Box>
    );
}

function KindLabel({ kind }: { kind: string }) {
    const display = stemKindRegistry.get(kind);
    return (
        <Box flexShrink={0} width={KIND_WIDTH}>
            <Text color={display.color} bold wrap="truncate-end">
                {display.label}
            </Text>
        </Box>
    );
}

/** A section's title line, with a dim note after it. */
export function SectionTitle({ text, note }: { text: string; note?: string }) {
    const theme = useTheme();
    return (
        <Box height={1} flexShrink={0} overflow="hidden" marginLeft={2}>
            <Box flexShrink={0} marginRight={2}>
                <Text color={theme.text.heading} bold>
                    {text}
                </Text>
            </Box>
            {note ? (
                <Text color={theme.text.muted} wrap="truncate-end">
                    {note}
                </Text>
            ) : null}
        </Box>
    );
}

/** The title line above the saved stems. */
export function SavedHeaderRow() {
    const theme = useTheme();
    return (
        <Box height={1} flexShrink={0} overflow="hidden">
            <Text color={theme.text.heading} bold>
                {"  SAVED STEMS"}
            </Text>
        </Box>
    );
}

type SavedRowProps = {
    stem: SavedStem;
    /** The track was saved under another name since: the stem does not follow it. */
    follows: boolean;
    isFocused: boolean;
    isActive: boolean;
    playback?: "playing" | "paused";
    onClick: () => void;
};

/** A stem saved in the library. Its file is looked for on disk (it may have been deleted or moved). */
export function SavedStemRow({ stem, follows, isFocused, isActive, playback, onClick }: SavedRowProps) {
    const theme = useTheme();
    const exists = useFileExists(stem.path);
    const missing = exists === false;
    const state = missing ? "✕ file not found" : follows ? "● saved" : "● name does not follow the track";
    const color = missing ? theme.status.error : follows ? theme.status.success : theme.status.warning;
    return (
        <RowFrame isFocused={isFocused} isActive={isActive} onClick={onClick} indent={1}>
            <KindLabel kind={stem.kind} />
            <Box flexShrink={0} marginRight={1}>
                <Text color={color}>{state}</Text>
            </Box>
            <Text color={theme.text.secondary} wrap="truncate-start">
                {stem.path}
            </Text>
            {playback ? (
                <Box flexShrink={0} marginLeft={1}>
                    <PlaybackIndicator state={playback} />
                </Box>
            ) : null}
        </RowFrame>
    );
}

type RunRowProps = {
    run: StemRun;
    collapsed: boolean;
    /** The run read another file than the one the track would be separated from now. */
    stale: boolean;
    isFocused: boolean;
    isActive: boolean;
    onClick: () => void;
};

/** A separation run: its model, where it is, and when it was made. */
export function RunRow({ run, collapsed, stale, isFocused, isActive, onClick }: RunRowProps) {
    const theme = useTheme();
    const state =
        run.state === "queued"
            ? { text: "queued (another separation runs)", color: theme.status.pending }
            : run.state === "separating"
              ? {
                    text: `${run.progressText ?? "separating"}${run.progress !== undefined ? ` ${Math.round(run.progress * 100)} %` : ""}`,
                    color: theme.status.processing,
                }
              : run.state === "failed"
                ? { text: `failed: ${run.error ?? "unknown error"}`, color: theme.status.error }
                : run.state === "stopped"
                  ? { text: "stopped", color: theme.status.skipped }
                  : { text: formatDate(run.finishedAt ?? run.startedAt), color: theme.text.muted };
    return (
        <RowFrame isFocused={isFocused} isActive={isActive} onClick={onClick}>
            <Box flexShrink={0} marginRight={1}>
                <Text color={theme.text.secondary}>{collapsed ? "▸" : "▾"}</Text>
            </Box>
            <Box flexShrink={0} marginRight={1}>
                <Text color={theme.text.primary} bold>
                    {describeStemRun(run)}
                </Text>
            </Box>
            <Box flexShrink={0} marginRight={1}>
                <Text color={theme.text.muted}>
                    · {run.input.kind === "saved" ? "from the saved file" : "from the download"}
                </Text>
            </Box>
            {stale ? (
                <Box flexShrink={0} marginRight={1}>
                    <Text color={theme.status.warning}>· made from an older file</Text>
                </Box>
            ) : null}
            {run.state === "separating" ? (
                <ProgressLine text={run.progressText ?? "separating"} fraction={run.progress} />
            ) : (
                <Text color={state.color} wrap="truncate-end">
                    · {state.text}
                </Text>
            )}
        </RowFrame>
    );
}

type StemRowProps = {
    stem: StemFile;
    /** This file is the one its stem uses now (saving takes it). */
    picked: boolean;
    /** A saved stem was made from this very run. */
    savedFromThis: boolean;
    isFocused: boolean;
    isActive: boolean;
    playback?: "playing" | "paused";
    onClick: () => void;
};

/** One stem a run separated (a temporary file until it is saved). */
export function StemFileRow({ stem, picked, savedFromThis, isFocused, isActive, playback, onClick }: StemRowProps) {
    const theme = useTheme();
    const missing = stem.state === "not_found";
    const info = stem.fileInfo;
    const details = [
        info?.format?.toUpperCase(),
        info?.sizeBytes ? formatBytes(info.sizeBytes) : undefined,
        savedFromThis ? "saved" : undefined,
    ]
        .filter(Boolean)
        .join(" · ");
    return (
        <RowFrame isFocused={isFocused} isActive={isActive} onClick={onClick} indent={2}>
            <Box flexShrink={0} width={2}>
                <Text color={theme.status.success}>{picked ? "✓" : " "}</Text>
            </Box>
            <KindLabel kind={stem.kind} />
            {missing ? (
                <Box flexShrink={0} marginRight={1}>
                    <Text color={theme.status.error}>✕ file not found</Text>
                </Box>
            ) : null}
            <Box flexShrink={1} marginRight={1} overflow="hidden">
                <Text color={missing ? theme.text.muted : theme.text.secondary} wrap="truncate-start">
                    {path.basename(stem.path)}
                </Text>
            </Box>
            <Box flexShrink={0}>
                <Text color={theme.text.muted}>{details}</Text>
            </Box>
            {playback ? (
                <Box flexShrink={0} marginLeft={1}>
                    <PlaybackIndicator state={playback} />
                </Box>
            ) : null}
        </RowFrame>
    );
}
