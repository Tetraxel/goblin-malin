import React, { useReducer, useEffect } from "react";
import { Box, Text } from "ink";
import { shortcutRegistry, ActiveHintContext, HintLineEntry, ShortcutEntry } from "#base/shortcuts/ShortcutRegistry";
import { getShortcutLiteral } from "#types/actions";
import { useTheme } from "#base/themeContext";

// ── Sub-components ────────────────────────────────────────────────────────────

const HintChip: React.FC<{ entry: ShortcutEntry; dim?: boolean }> = ({ entry, dim }) => {
    const theme = useTheme();
    return (
        <Box marginRight={1} flexShrink={0}>
            <Text color={theme.text.active} dimColor={dim} bold>
                [{getShortcutLiteral([entry.shortcut])}]
            </Text>
            <Text color={theme.text.hint} dimColor={dim}>
                {" "}
                {entry.label}
            </Text>
        </Box>
    );
};

const HintLine: React.FC<{ line: HintLineEntry; contextShortcuts: ShortcutEntry[]; dim?: boolean; width: number }> = ({
    line,
    contextShortcuts,
    dim,
    width,
}) => {
    const theme = useTheme();

    const matchedShortcuts = line.shortcutIds
        .map((sid) => contextShortcuts.find((s) => s.id === sid))
        .filter((s): s is ShortcutEntry => s !== undefined);

    return (
        <Box flexDirection="row" width={width} overflow="hidden" flexShrink={0}>
            {/* Left side */}
            <Box marginRight={1} flexShrink={0}>
                {line.left.type === "node" ? (
                    line.left.renderNode(dim ?? false)
                ) : (
                    <Text color={line.left.color ?? theme.text.active} dimColor={dim} bold={line.left.bold ?? true}>
                        {line.left.value}
                    </Text>
                )}
            </Box>

            {/* Separator */}
            <Box marginRight={1} flexShrink={0}>
                <Text color={theme.text.active} dimColor={dim}>
                    {"›"}
                </Text>
            </Box>

            {/* Hint chips */}
            {matchedShortcuts.map((entry) => (
                <HintChip key={entry.id} entry={entry} dim={dim} />
            ))}
        </Box>
    );
};

// ── DynamicHintBar ────────────────────────────────────────────────────────────

interface DynamicHintBarProps {
    width: number;
    /** When false, all hints are dimmed but still shown. Useful for panel-level dim. */
    isActive?: boolean;
}

/**
 * Renders all currently-active hint lines from the ShortcutRegistry.
 * Lines are ordered by context priority (highest = most specific = top line).
 * Re-renders automatically whenever the registry's hint view changes.
 */
export const DynamicHintBar: React.FC<DynamicHintBarProps> = ({ width, isActive = true }) => {
    const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

    useEffect(() => {
        return shortcutRegistry.subscribe(forceUpdate);
    }, []);

    if (!isActive) return null;

    const contexts: ActiveHintContext[] = shortcutRegistry.getActiveHintContexts();

    if (contexts.length === 0) return null;

    return (
        <Box
            flexDirection="column"
            width={width}
            overflow="hidden"
            marginLeft={1}
            alignItems="flex-start"
            justifyContent="flex-start"
            flexShrink={0}
        >
            {contexts.map((ctx) =>
                ctx.lines.map((line) => (
                    <HintLine
                        key={`${ctx.contextId}-${line.id}`}
                        line={line}
                        contextShortcuts={ctx.shortcuts}
                        dim={!isActive}
                        width={width - 2}
                    />
                ))
            )}
        </Box>
    );
};
