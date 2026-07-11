import React from "react";
import path from "path";
import { Text } from "ink";
import { ColumnComponent } from "#components/TaskListPanel/TaskListPanel";
import { MusicDownloadTaskAttributes, TrackDownloadSource } from "#flows/musicDownloadFlow/types";

// Unlike yt-dlp (always exactly one row), Soulseek can produce several candidate
// rows for one track — pick the single most relevant one to summarize in this
// narrow column: the winning selection, else whatever's actively in flight, else
// the most recent attempt.
function pickPrimarySource(sources: TrackDownloadSource[]): TrackDownloadSource | undefined {
    return (
        sources.find((s) => s.selected) ??
        sources.find((s) => s.state === "downloaded") ??
        sources.find((s) => s.state === "downloading") ??
        sources.find((s) => s.state === "searching") ??
        sources.find((s) => s.state === "pending") ??
        sources[sources.length - 1]
    );
}

export const SoulseekCell: ColumnComponent<MusicDownloadTaskAttributes> = ({ task, isSelected }) => {
    const attrs = task.attributes;
    const soulseekSources =
        attrs?.kind === "track" ? attrs.downloadSources.filter((d) => d.provider === "soulseek") : [];
    const downloadSource = pickPrimarySource(soulseekSources);

    const saved = downloadSource?.savedFile;
    const display = saved
        ? path.basename(saved.path)
        : (downloadSource?.localFile?.name ?? downloadSource?.state ?? "");

    const color = saved
        ? "cyan"
        : downloadSource?.state === "downloaded"
          ? "green"
          : downloadSource?.state === "failed"
            ? "red"
            : "white";

    return (
        <Text color={color} underline={isSelected} wrap="truncate-end">
            {display}
        </Text>
    );
};
