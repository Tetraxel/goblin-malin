import React from "react";
import { Box, Text } from "ink";
import { providerDisplayRegistry } from "#base/providerDisplay";
import { ColumnComponentProps } from "#components/TaskListPanel/TaskListPanel";
import { AnimatedIcon, Icon } from "#components/AnimatedIcon";
import { MusicDownloadTaskAttributes } from "#flows/musicDownloadFlow/types";

const PROVIDER_KEY = "claude";

export const ClaudeCell = React.memo(function ClaudeCell({
    task,
    isSelected,
}: ColumnComponentProps<MusicDownloadTaskAttributes>) {
    const attrs = task.attributes;
    const color = providerDisplayRegistry.get(PROVIDER_KEY).color;

    // The status row owns the "Asking Claude…" text; here the animated mark just says "Claude is on it".
    if (task.status.icon === "agent") {
        return (
            <Box flexShrink={0}>
                <AnimatedIcon icon={Icon.Agent} interval={160} color={color} />
            </Box>
        );
    }

    const anchor = attrs?.kind === "track" ? attrs.discoveryAnchors?.[PROVIDER_KEY] : undefined;
    // Claude is a last resort: most tasks never run it. Show nothing rather than a misleading ✗.
    if (!anchor) return null;

    const count =
        anchor.count ??
        (attrs?.kind === "track"
            ? attrs.metadataGroups.reduce(
                  (sum, g) =>
                      sum +
                      g.results.filter((r) => r.discoverySources.some((s) => s.discoveredBy === PROVIDER_KEY)).length,
                  0
              )
            : 0);
    const found = anchor.state === "found" && count > 0;

    return (
        <Text color={found ? color : "gray"} underline={isSelected} wrap="truncate-end">
            {found ? `✓ ${count}` : "✗"}
        </Text>
    );
});
