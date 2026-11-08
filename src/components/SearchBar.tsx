import React from "react";
import { Text } from "ink";
import { TextInput } from "#components/TextInput";
import { ClickArea } from "#base/mouse/ClickArea";
import { useTheme } from "#base/themeContext";
import type { FocusableWindow } from "#hooks/useFocusManager";

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
    mouseWindow,
    onFocusRequest,
}: {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    highlighted: boolean;
    inputFocus: boolean;
    mouseWindow: FocusableWindow;
    onFocusRequest: () => void;
}) {
    const theme = useTheme();
    const borderColor = highlighted ? theme.action.primary : theme.text.secondary;
    return (
        <ClickArea
            window={mouseWindow}
            onClick={onFocusRequest}
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
        </ClickArea>
    );
}
