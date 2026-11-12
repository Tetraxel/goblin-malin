import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "#base/themeContext";
import { providerDisplayRegistry } from "#base/providerDisplay";
import { type MusicBrainzIds } from "#flows/musicDownloadFlow/utils/compiledMetadata";
import { type MusicBrainzIdentity } from "#flows/musicDownloadFlow/musicbrainz/types";
import { MusicBrainzButton, MusicBrainzRecheckButton } from "./MusicBrainzRecheckButton";

// Same grid as the field rows above (`FieldRow`): 1 padding + 2 for the cursor, then a 10-wide label.
const LEFT = 3;
const LABEL_WIDTH = 10;

/** One thing to do about the verdict, as a button. */
export type MusicBrainzButtonSpec = { id: string; label: string; run: () => void };

function statusText(identity: MusicBrainzIdentity): string {
    switch (identity.verdict) {
        case "matched":
            return `✔ release matched${identity.decidedBy === "user" ? " (your choice)" : ""}`;
        case "needsReview":
            return `? needs your review (${identity.candidates.length} candidate${identity.candidates.length === 1 ? "" : "s"})`;
        case "notFound":
            return "✚ not in MusicBrainz yet";
        default:
            return "… could not tell";
    }
}

/**
 * The compiled metadata's MusicBrainz block, ordered by what the user needs first: the status, then what to do about
 * it (buttons: review the match, choose the artist, add the release, open it, re-check), then the evidence, then the
 * IDs that go into the saved file (last, because they are what gets cut when the panel is short).
 */
export const MusicBrainzSection: React.FC<{
    identity: MusicBrainzIdentity | undefined;
    ids: MusicBrainzIds | undefined;
    /** The sources changed since `identity` was made: its status is dimmed. */
    stale?: boolean;
    /** Show the "sources changed: re-check" button (or "check", when there is no verdict yet). */
    showRecheck?: boolean;
    /** A check is running (this button and the one next to the compiled row share it). */
    checking?: boolean;
    onRecheck?: () => void;
    /** What can be done about the verdict now. */
    actions?: MusicBrainzButtonSpec[];
}> = React.memo(function MusicBrainzSection({
    identity,
    ids,
    stale = false,
    showRecheck = false,
    checking = false,
    onRecheck,
    actions = [],
}) {
    const theme = useTheme();
    // The labels take MusicBrainz' own (bright, so it reads on a dark background) colour, like a provider badge.
    const labelColor = providerDisplayRegistry.get("musicBrainz").colorBright;
    const recheck = showRecheck && onRecheck;
    if (!identity && !recheck) return null;

    const color =
        identity?.verdict === "matched"
            ? theme.status.success
            : identity?.verdict === "needsReview"
              ? theme.status.warning
              : identity?.verdict === "notFound"
                ? "#ba47b5"
                : theme.text.secondary;

    const rows: [string, string | undefined][] = [
        ["Release", ids?.release],
        ["Recording", ids?.recording],
        ["Artist", ids?.artist],
        ["Group", ids?.releaseGroup],
    ];

    const idRows = rows.filter((row): row is [string, string] => !!row[1]);
    const showHandedOff = !!identity?.handedOffAt && identity.verdict !== "matched";

    // The re-check call-to-action leads when it is shown: the sources changed, so what is below may be out of date.
    const buttons = (
        <Box flexDirection="row" flexWrap="wrap" columnGap={1} flexShrink={0}>
            {recheck && (
                <MusicBrainzRecheckButton
                    label={identity ? "↻ Sources changed: re-check" : "↻ Check on MusicBrainz"}
                    busy={checking}
                    onRecheck={onRecheck}
                />
            )}
            {actions.map((a) => (
                <MusicBrainzButton key={a.id} label={a.label} onClick={a.run} />
            ))}
        </Box>
    );

    return (
        <Box flexDirection="column" flexShrink={0} marginTop={1} paddingLeft={LEFT}>
            {identity ? (
                <>
                    <Box flexDirection="row">
                        <Box width={LABEL_WIDTH} flexShrink={0}>
                            <Text color={labelColor} bold>
                                {"MBRAINZ".padEnd(LABEL_WIDTH)}
                            </Text>
                        </Box>
                        <Text color={color} dimColor={stale} wrap="truncate-end">
                            {statusText(identity)}
                        </Text>
                    </Box>
                    {(recheck || actions.length > 0) && (
                        <Box marginLeft={LABEL_WIDTH} marginTop={1} flexShrink={0}>
                            {buttons}
                        </Box>
                    )}
                    {(identity.evidence.length > 0 || showHandedOff) && (
                        <Box marginLeft={LABEL_WIDTH} marginTop={1} flexDirection="column" flexShrink={0}>
                            {identity.evidence.slice(0, 2).map((line, i) => (
                                <Text key={i} color={theme.text.secondary} wrap="truncate-end">
                                    {line}
                                </Text>
                            ))}
                            {showHandedOff && (
                                <Text color={theme.text.secondary} wrap="truncate-end">
                                    Handed over to MusicBrainz: re-check once the release is added
                                </Text>
                            )}
                        </Box>
                    )}
                    {idRows.length > 0 && (
                        <Box marginTop={1} flexDirection="column" flexShrink={0}>
                            {idRows.map(([label, value]) => (
                                <Box key={label} flexDirection="row">
                                    <Box width={LABEL_WIDTH} flexShrink={0}>
                                        <Text color={labelColor} bold>
                                            {label.toUpperCase().padEnd(LABEL_WIDTH)}
                                        </Text>
                                    </Box>
                                    <Text color={theme.field.normal} wrap="truncate-end">
                                        {value}
                                    </Text>
                                </Box>
                            ))}
                        </Box>
                    )}
                </>
            ) : (
                <>{buttons}</>
            )}
        </Box>
    );
});
