import React from "react";
import { Box, Text } from "ink";
import { providerDisplayRegistry } from "#base/providerDisplay";
import { useTheme } from "#base/themeContext";
import type { TrackDownloadSource } from "#flows/musicDownloadFlow/types";

/** Label column of the side-by-side view: narrower than the full pane's, as two panels share the width. */
export const COMPACT_LABEL_W = 9;

/** How a value relates to the other version: untouched, or only in the old one (removed). */
export type DiffTone = "same" | "removed";

/**
 * One read-only `LABEL  value` row of the OLD panel. It mirrors the layout of the NEW panel's `FocusRow`
 * (same gutter, label column and look) so the two line up. Values never wrap: both panels must stay row
 * for row aligned, so a long one is cut in the middle.
 */
export function DiffCell({
    label,
    value,
    tone = "same",
    variant = "plain",
}: {
    label: string;
    value: string;
    tone?: DiffTone;
    variant?: "plain" | "attribute";
}) {
    const theme = useTheme();
    const attribute = variant === "attribute";
    const valueColor =
        tone === "removed" ? theme.status.error : attribute ? theme.fileAttributes.value : theme.text.primary;
    return (
        <Box
            flexDirection="row"
            paddingX={1}
            height={1}
            flexShrink={0}
            overflow="hidden"
            backgroundColor={attribute ? theme.fileAttributes.background : undefined}
        >
            <Box width={2} minWidth={2} flexShrink={0} />
            <Box width={COMPACT_LABEL_W} minWidth={COMPACT_LABEL_W} flexShrink={0} marginRight={1}>
                <Text color={attribute ? theme.fileAttributes.label : theme.ui.border} bold wrap="truncate-end">
                    {attribute
                        ? label.toUpperCase().padStart(COMPACT_LABEL_W)
                        : label.toUpperCase().padEnd(COMPACT_LABEL_W)}
                </Text>
            </Box>
            <Box flexGrow={1} flexShrink={1} overflow="hidden">
                <Text color={valueColor} bold={attribute} dimColor={value === "—"} wrap="truncate-middle">
                    {value}
                </Text>
            </Box>
        </Box>
    );
}

/** `SOURCE  YtDlp > YouTube`: which provider produced the file, and from which platform's track. */
export function SourceCell({ source }: { source: TrackDownloadSource }) {
    const theme = useTheme();
    const provider = providerDisplayRegistry.get(source.provider);
    const platform = providerDisplayRegistry.get(source.track.platform);
    return (
        <Box flexDirection="row" paddingX={1} height={1} flexShrink={0} overflow="hidden">
            <Box flexShrink={0}>
                <Text color={theme.text.secondary}>{"SOURCE  "}</Text>
            </Box>
            <Box flexShrink={0}>
                <Text color={provider.color}>{provider.label}</Text>
            </Box>
            <Box flexShrink={0}>
                <Text color={theme.text.secondary}>{" > "}</Text>
            </Box>
            <Box flexShrink={1} overflow="hidden">
                <Text color={platform.color} wrap="truncate-end">
                    {platform.label}
                </Text>
            </Box>
        </Box>
    );
}
