import React from "react";
import { Text } from "ink";
import { useTheme } from "#base/themeContext";
import { type ColumnComponentProps } from "#components/TaskListPanel/TaskListPanel";
import { type MusicDownloadTaskAttributes } from "#flows/musicDownloadFlow/types";
import { type MbVerdict } from "#flows/musicDownloadFlow/musicbrainz/types";

/** One glyph per verdict: matched, needs a look, ruled out (can be added), could not tell. */
const VERDICT_GLYPH: Record<MbVerdict, string> = {
    matched: "✔",
    needsReview: "?",
    notFound: "✚",
    unknown: "…",
};

export const MusicBrainzCell = React.memo(function MusicBrainzCell({
    task,
    isSelected,
}: ColumnComponentProps<MusicDownloadTaskAttributes>) {
    const theme = useTheme();
    const attrs = task.attributes;
    const anchor = attrs?.kind === "track" ? attrs.discoveryAnchors?.["musicBrainz"] : undefined;
    const identity = attrs?.kind === "track" ? attrs.musicBrainzIdentity : undefined;

    // Which MusicBrainz release the track is on (P30) outranks the recording-link count below.
    if (identity) {
        const color =
            identity.verdict === "matched"
                ? theme.status.success
                : identity.verdict === "needsReview"
                  ? theme.status.warning
                  : identity.verdict === "notFound"
                    ? "#ba47b5"
                    : "gray";
        return (
            <Text color={color} underline={isSelected} wrap="truncate-end">
                {VERDICT_GLYPH[identity.verdict]}
            </Text>
        );
    }

    // Use stored count when available (O(1)); fall back to scanning discoverySources
    // for tasks run before the anchor field existed (e.g. loaded from an old session).
    const count =
        anchor?.count ??
        (attrs?.kind === "track"
            ? attrs.metadataGroups.reduce(
                  (sum, g) =>
                      sum +
                      g.results.filter((r) => r.discoverySources.some((s) => s.discoveredBy === "musicBrainz")).length,
                  0
              )
            : 0);

    const hasResult = count > 0 || anchor?.state === "found";
    const color = hasResult ? "#ba47b5" : "gray";

    return (
        <Text color={color} underline={isSelected} wrap="truncate-end">
            {hasResult ? `✓ ${count}` : "✗"}
        </Text>
    );
});
