import React from "react";
import { Box, Text } from "ink";
import { MetadataGroupState } from "#flows/musicDownloadFlow/types";
import { providerDisplayRegistry } from "#base/providerDisplay";
import { useTheme } from "#base/themeContext";
import { CursorPosition } from "#hooks/useFocusManager";
import { Hint } from "../Hint";
import { Uri } from "./MetadataPanel/Uri";

interface SourcesHintBarProps {
    groups: MetadataGroupState[];
    cursor: CursorPosition;
    innerFocus: "list" | "detail";
    isActive: boolean;
    width: number;
}

export const SourcesHintBar: React.FC<SourcesHintBarProps> = ({ groups, cursor, innerFocus, isActive, width }) => {
    const theme = useTheme();
    const dim = !isActive || innerFocus !== "list";
    const sortedGroups = [...groups].sort((a, b) => a.rank - b.rank);

    if (cursor.type === "compiled") {
        return (
            <Box
                flexDirection="column"
                width={width}
                overflow="hidden"
                marginLeft={1}
                alignItems="flex-end"
                justifyContent="flex-end"
                flexShrink={0}
            >
                <Box flexDirection="row" width={width} overflow="hidden" flexShrink={0}>
                    <Box marginRight={1} flexShrink={0}>
                        <Text color={theme.text.active} dimColor={dim} bold>
                            Compiled Metadata
                        </Text>
                    </Box>
                    <Box marginRight={2} flexShrink={0}>
                        <Text color={theme.text.active} dimColor={dim}>
                            {" >>>"}
                        </Text>
                    </Box>
                </Box>
                <Box flexDirection="row" width={width} overflow="hidden" flexShrink={0}>
                    <Box marginRight={1} flexShrink={0}>
                        <Text color={theme.text.active} dimColor={dim} bold>
                            Metadata Panel
                        </Text>
                    </Box>
                    <Box marginRight={2} flexShrink={0}>
                        <Text color={theme.text.active} dimColor={dim}>
                            {" >>>"}
                        </Text>
                    </Box>
                    <Hint label="Shrink" shortcut="Shift+←" dim={dim} />
                    <Hint label="Expand" shortcut="Shift+→" dim={dim} />
                    <Hint label="Toggle search details" shortcut="E" dim={dim} />
                </Box>
            </Box>
        );
    }

    if (cursor.type === "group") {
        const group = sortedGroups[cursor.groupIndex];
        const display = group ? providerDisplayRegistry.get(group.serviceKey) : null;
        const platformLabel = display?.label ?? "";
        return (
            <Box
                flexDirection="column"
                width={width}
                overflow="hidden"
                marginLeft={1}
                alignItems="flex-end"
                justifyContent="flex-end"
                flexShrink={0}
            >
                <Box flexDirection="row" width={width} overflow="hidden" flexShrink={0}>
                    <Box marginRight={1} flexShrink={0}>
                        <Text color={display?.color ?? theme.text.active} dimColor={dim} bold>
                            {platformLabel}
                        </Text>
                    </Box>
                    <Box marginRight={2} flexShrink={0}>
                        <Text color={theme.text.active} dimColor={dim}>
                            {" >>>"}
                        </Text>
                    </Box>
                    <Hint label="Reject all" shortcut="Del" dim={dim} />
                    <Hint label="Move up" shortcut="Shift+↑" dim={dim} />
                    <Hint label="Move down" shortcut="Shift+↓" dim={dim} />
                </Box>
                <Box flexDirection="row" width={width} overflow="hidden" flexShrink={0}>
                    <Box marginRight={1} flexShrink={0}>
                        <Text color={theme.text.active} dimColor={dim} bold>
                            Metadata Panel
                        </Text>
                    </Box>
                    <Box marginRight={2} flexShrink={0}>
                        <Text color={theme.text.active} dimColor={dim}>
                            {" >>>"}
                        </Text>
                    </Box>
                    <Hint label="Shrink" shortcut="Shift+←" dim={dim} />
                    <Hint label="Expand" shortcut="Shift+→" dim={dim} />
                    <Hint label="Toggle search details" shortcut="E" dim={dim} />
                </Box>
            </Box>
        );
    }

    // cursor.type === "result"
    const { groupIndex: gi, resultIndex: ri } = cursor;
    const group = sortedGroups[gi];
    const result = group ? [...group.results].sort((a, b) => a.rank - b.rank)[ri] : undefined;
    const m = result?.metadata;
    const uri = m ? (m.uri ?? `${m.platform.toUpperCase()}::TRACK::${m.id}`) : "";
    const pos = ri + 1;
    const total = group?.results.length ?? 0;
    const isRejected = result?.isRejected ?? false;
    const isFav = result?.isFavorited ?? false;

    return (
        <Box
            flexDirection="column"
            width={width}
            overflow="hidden"
            marginLeft={1}
            alignItems="flex-end"
            justifyContent="flex-end"
            flexShrink={0}
        >
            <Box flexDirection="row" width={width} overflow="hidden" flexShrink={0}>
                {m && uri && (
                    <Box flexShrink={0} marginRight={1}>
                        <Uri uri={uri} platform={m.platform} dimmed={dim} />
                    </Box>
                )}
                {m && (
                    <>
                        <Box marginRight={2} flexShrink={0}>
                            <Text color={theme.text.active} dimColor={dim}>
                                {" >>>"}
                            </Text>
                        </Box>
                        <Hint label="Open link" shortcut="Enter" dim={dim} />
                        <Hint label="Copy link" shortcut="Ctrl+C" dim={dim} />
                    </>
                )}
            </Box>
            <Box flexDirection="row" width={width} overflow="hidden" flexShrink={0}>
                <Box marginLeft={1} marginRight={1} flexShrink={0}>
                    <Text color={theme.text.active} dimColor={dim} bold>{`Source ${pos}/${total}`}</Text>
                </Box>
                <Box marginRight={2} flexShrink={0}>
                    <Text color={theme.text.active} dimColor={dim}>
                        {" >>>"}
                    </Text>
                </Box>
                <Hint label={isFav ? "Unfavorite" : "Set as favorite"} shortcut="F" dim={dim} />
                <Hint label={isRejected ? "Unreject" : "Reject"} shortcut="Del" dim={dim} />
                <Hint label="Move up" shortcut="Shift+↑" dim={dim} />
                <Hint label="Move down" shortcut="Shift+↓" dim={dim} />
                <Hint label="Refetch" shortcut="R" dim={dim} />
            </Box>
            <Box flexDirection="row" width={width} overflow="hidden" flexShrink={0}>
                <Box marginLeft={1} marginRight={1} flexShrink={0}>
                    <Text color={theme.text.active} dimColor={dim} bold>
                        Metadata Panel
                    </Text>
                </Box>
                <Box marginRight={2} flexShrink={0}>
                    <Text color={theme.text.active} dimColor={dim}>
                        {" >>>"}
                    </Text>
                </Box>
                <Hint label="Shrink" shortcut="Shift+←" dim={dim} />
                <Hint label="Expand" shortcut="Shift+→" dim={dim} />
                <Hint label="Toggle search details" shortcut="E" dim={dim} />
            </Box>
        </Box>
    );
};
