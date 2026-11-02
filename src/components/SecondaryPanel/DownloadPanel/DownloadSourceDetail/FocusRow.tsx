import React, { useRef } from "react";
import { Box, Text, type DOMElement } from "ink";
import TextInput from "ink-text-input";
import { useClickTarget } from "#base/mouse/useMouseTarget";
import { useTheme } from "#base/themeContext";

export const LABEL_W = 11;

export interface FocusRowEdit {
    draft: string;
    /** Why the draft was refused, shown next to it. */
    error: string | null;
    /** Changing it remounts the input, so its cursor lands at the end of a draft that was rewritten. */
    inputKey: number;
    onChange: (draft: string) => void;
    onSubmit: (draft: string) => void;
    /** Fixed text after the input that is not part of the draft (e.g. a file extension). */
    suffix?: string;
}

export interface FocusRowProps {
    label: string;
    value: string;
    isFocused?: boolean;
    /** Replaces the value with a text input. */
    edit?: FocusRowEdit;
    valueColor?: string;
    dim?: boolean;
    /** Small note after the value, e.g. which provider it came from or "EDITED". */
    badge?: { text: string; color: string; italic?: boolean; strong?: boolean };
    /** "attribute" is the yellow "File attributes" look: right-aligned labels on a tinted background. */
    variant?: "plain" | "attribute";
}

/**
 * A `LABEL  value` row of the file detail. Every row keeps the same 2-column gutter, so rows the
 * cursor can reach and rows it can't stay aligned; the focused one gets the pointer in it.
 */
export function FocusRow({
    label,
    value,
    isFocused = false,
    edit,
    valueColor,
    dim,
    badge,
    variant = "plain",
}: FocusRowProps) {
    const theme = useTheme();
    const attribute = variant === "attribute";
    const labelText = attribute ? label.toUpperCase().padStart(LABEL_W) : label.toUpperCase().padEnd(LABEL_W);
    const labelColor = isFocused ? theme.field.selected : attribute ? theme.fileAttributes.label : theme.ui.border;
    return (
        <Box
            flexDirection="row"
            paddingX={1}
            marginX={attribute ? 1 : 0}
            height={edit ? undefined : 1}
            flexShrink={0}
            backgroundColor={attribute ? theme.fileAttributes.background : undefined}
        >
            <Box width={2} minWidth={2} flexShrink={0}>
                {isFocused && <Text color={theme.text.active}>{"☛"}</Text>}
            </Box>
            <Box width={LABEL_W} minWidth={LABEL_W} flexShrink={0} marginRight={1}>
                <Text color={labelColor} bold wrap="truncate-end">
                    {labelText}
                </Text>
            </Box>
            {edit ? (
                <Box flexGrow={1} flexShrink={1} flexDirection="row" flexWrap="wrap">
                    <TextInput
                        key={edit.inputKey}
                        value={edit.draft}
                        onChange={edit.onChange}
                        onSubmit={edit.onSubmit}
                    />
                    {edit.suffix && <Text color={theme.text.secondary}>{edit.suffix}</Text>}
                    {edit.error && <Text color={theme.field.error}> ✗ {edit.error}</Text>}
                </Box>
            ) : (
                <Box flexGrow={1} flexShrink={1}>
                    <Text
                        color={valueColor ?? (attribute ? theme.fileAttributes.value : theme.text.primary)}
                        bold={attribute}
                        dimColor={dim || value === "—"}
                        underline={isFocused}
                        wrap="truncate-end"
                    >
                        {value}
                    </Text>
                </Box>
            )}
            {badge && !edit && (
                <Box flexShrink={0} paddingLeft={1}>
                    <Text color={badge.color} dimColor={!badge.strong} bold={badge.strong} italic={badge.italic}>
                        {badge.text}
                    </Text>
                </Box>
            )}
        </Box>
    );
}

/** The yellow title bar of the "File attributes" block. */
export function AttributesHeader({ label }: { label: string }) {
    const theme = useTheme();
    return (
        <Box paddingX={1} marginX={1} height={1} flexShrink={0} backgroundColor={theme.fileAttributes.header}>
            <Text color={theme.fileAttributes.headerText} bold wrap="truncate-end">
                {label}
            </Text>
        </Box>
    );
}

/** Calls `onClick` when anything inside it is left-clicked. */
export function ClickableBox({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
    const ref = useRef<DOMElement>(null);
    useClickTarget(ref, onClick);
    return (
        <Box ref={ref} flexDirection="column" flexShrink={0}>
            {children}
        </Box>
    );
}
