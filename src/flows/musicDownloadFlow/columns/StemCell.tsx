import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "#base/themeContext";
import { type Theme } from "#base/theme";
import { type ColumnComponent, type ColumnComponentProps } from "#components/TaskListPanel/TaskListPanel";
import { useNowPlaying } from "#hooks/useNowPlaying";
import { useFileExists } from "#hooks/useFileExists";
import { type MusicDownloadTaskAttributes, type StemKind } from "#flows/musicDownloadFlow/types";
import { stemCellState, type StemCellState } from "#flows/musicDownloadFlow/stems/stemFiles";

type Look = { glyph: string; text: string; color: string };

function lookOf(cell: StemCellState, theme: Theme, savedMissing: boolean): Look {
    switch (cell.state) {
        case "none":
            return { glyph: "", text: "—", color: theme.text.muted };
        case "queued":
            return { glyph: "…", text: "queued", color: theme.status.pending };
        case "separating":
            return {
                glyph: "◌",
                text: cell.progress !== undefined ? `${Math.round(cell.progress * 100)} %` : "separating",
                color: theme.status.processing,
            };
        case "failed":
            return { glyph: "✕", text: "failed", color: theme.status.error };
        case "temp":
            return { glyph: "◐", text: "not saved", color: theme.status.warning };
        case "tempMissing":
            return { glyph: "✕", text: "file not found", color: theme.status.error };
        case "saved":
            if (savedMissing) return { glyph: "✕", text: "saved · missing", color: theme.status.error };
            return cell.follows
                ? { glyph: "●", text: "saved", color: theme.status.success }
                : { glyph: "●", text: "saved · renamed?", color: theme.status.warning };
    }
}

/** The ▶ / ⏸ of the stem being played. Only mounted on the row the player plays, so other rows never subscribe. */
function PlayingMark({ path }: { path: string }) {
    const theme = useTheme();
    const nowPlaying = useNowPlaying();
    if (nowPlaying?.filePath !== path) return null;
    return (
        <Box flexShrink={0} marginLeft={1}>
            <Text color={theme.ui.progressFill}>{nowPlaying.isPaused ? "⏸" : "▶"}</Text>
        </Box>
    );
}

function StemCellView({
    task,
    isSelected,
    playback,
    kind,
}: ColumnComponentProps<MusicDownloadTaskAttributes> & { kind: StemKind }) {
    const theme = useTheme();
    const attrs = task.attributes?.kind === "track" ? task.attributes : undefined;
    const cell = attrs ? stemCellState(attrs, kind) : ({ state: "none" } as const);
    // A saved stem deleted behind the app's back: looked for on disk, like the saved track.
    const savedExists = useFileExists(cell.state === "saved" ? cell.path : undefined);
    // An album, a playlist or a group has no stems of its own: its tracks do.
    if (!attrs) return null;
    const look = lookOf(cell, theme, cell.state === "saved" && savedExists === false);
    const path = cell.state === "saved" || cell.state === "temp" ? cell.path : undefined;
    return (
        <Box flexDirection="row" overflow="hidden">
            {look.glyph ? (
                <Box flexShrink={0} marginRight={1}>
                    <Text color={look.color}>{look.glyph}</Text>
                </Box>
            ) : null}
            <Text color={look.color} underline={isSelected} wrap="truncate-end">
                {look.text}
            </Text>
            {playback && path ? <PlayingMark path={path} /> : null}
        </Box>
    );
}

const cells = new Map<StemKind, ColumnComponent<MusicDownloadTaskAttributes>>();

/** The cell of one stem's column in the Stems view (one component per kind, kept so React sees the same type). */
export function stemCellFor(kind: StemKind): ColumnComponent<MusicDownloadTaskAttributes> {
    let cell = cells.get(kind);
    if (!cell) {
        cell = React.memo(function StemCell(props: ColumnComponentProps<MusicDownloadTaskAttributes>) {
            return <StemCellView {...props} kind={kind} />;
        });
        cells.set(kind, cell);
    }
    return cell;
}
