import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { useTheme } from "#base/themeContext";

/**
 * Shared search field used by the Settings, Shortcuts, and Sessions modals.
 * Renders the bordered "⌕ …" input. `highlighted` drives the focused styling
 * (border + icon), `inputFocus` controls whether the TextInput captures keys.
 */
export function SearchBar({
    value,
    onChange,
    placeholder,
    highlighted,
    inputFocus,
}: {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    highlighted: boolean;
    inputFocus: boolean;
}) {
    const theme = useTheme();
    const borderColor = highlighted ? theme.action.primary : theme.text.secondary;
    return (
        <Box
            marginTop={1}
            borderStyle="single"
            borderColor={borderColor}
            borderBackgroundColor={theme.ui.background}
            paddingX={1}
            height={3}
            flexShrink={0}
        >
            <Text dimColor={!highlighted} color={highlighted ? theme.action.primary : undefined}>
                {"⌕ "}
            </Text>
            <TextInput value={value} onChange={onChange} placeholder={placeholder} focus={inputFocus} />
        </Box>
    );
}
