import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "#base/themeContext";
import { useShortcutLiteral } from "#hooks/useShortcutLiteral";

/**
 * Renders a `[key] label` hint.
 *
 * Prefer the config-aware forms so the displayed key always matches the live
 * (possibly remapped) binding:
 *   <Hint label="Delete" shortcutId="sessionsModal.delete" />
 *   <Hint label="Navigate" shortcutIds={["settingsModal.up", "settingsModal.down"]} />
 *
 * The legacy `shortcut` string is kept for hints that aren't backed by the
 * keybinding registry (e.g. ActionBar's flow actions, or keys owned by
 * third-party ink inputs).
 */
export function Hint({
    label,
    shortcut,
    shortcutId,
    shortcutIds,
    dim,
}: {
    label: string;
    shortcut?: string;
    shortcutId?: string;
    shortcutIds?: string[];
    dim?: boolean;
}) {
    const theme = useTheme();
    const resolved = useShortcutLiteral(shortcutIds ?? (shortcutId ? [shortcutId] : []));
    const display = shortcutIds || shortcutId ? resolved : (shortcut ?? "");
    return (
        <Box marginRight={2} flexShrink={0}>
            <Text color={theme.text.active} dimColor={dim} bold>
                [{display}]
            </Text>
            <Text color={theme.text.hint} dimColor={dim}>
                {" "}
                {label}
            </Text>
        </Box>
    );
}
