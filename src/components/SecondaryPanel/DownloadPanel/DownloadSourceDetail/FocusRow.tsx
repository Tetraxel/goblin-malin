import React, { useRef } from "react";
import { Box, Text, type DOMElement } from "ink";
import { TextInput } from "#components/TextInput";
import stringWidth from "string-width";
import wrapAnsi from "wrap-ansi";
import { useClickTarget } from "#base/mouse/useMouseTarget";
import { useTheme } from "#base/themeContext";
import { type Theme } from "#base/theme";

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

/**
 * How many terminal rows an edit row takes when its value column is `valueWidth` wide: the draft (plus the
 * cursor) wraps, then the suffix and the error follow it on the same row when they fit, or go to the next one.
 * The side-by-side view needs it to give the OLD panel's matching row the same height.
 */
export function editRowLines(edit: Pick<FocusRowEdit, "draft" | "suffix" | "error">, valueWidth: number): number {
    const width = Math.max(1, valueWidth);
    const draftLines = wrapAnsi(`${edit.draft} `, width, { hard: true, trim: false }).split("\n");
    let lines = draftLines.length;
    // A draft that wrapped has been squeezed to the whole row: what follows starts on a new one.
    let used = lines > 1 ? width : stringWidth(draftLines[0] ?? "");
    for (const item of [edit.suffix, edit.error ? ` ✗ ${edit.error}` : undefined]) {
        if (!item) continue;
        const itemWidth = stringWidth(item);
        if (used + itemWidth <= width) {
            used += itemWidth;
        } else {
            const itemLines = wrapAnsi(item, width, { hard: true, trim: false }).split("\n");
            lines += itemLines.length;
            used = itemLines.length > 1 ? width : stringWidth(itemLines[0] ?? "");
        }
    }
    return lines;
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
    /** Width of the label column. Defaults to the full pane's; the side-by-side view passes a narrower one. */
    labelWidth?: number;
    /** Keep a 1-column margin around an attribute row. The side-by-side view has no width to spare. */
    inset?: boolean;
    /** Terminal rows the value takes (it contains line breaks when above 1). Defaults to a single, truncated row. */
    lines?: number;
    /** Overrides the label's colour (a provider's own, for the rows that are about it). */
    labelColor?: string;
    /** The colours of an "attribute" row, when it is not the yellow "File attributes" block (e.g. MusicBrainz'). */
    tint?: AttributesTint;
    /** Where a value too long for its column is cut. Ids keep their ends readable with "truncate-middle". */
    truncate?: "truncate-end" | "truncate-middle";
}

/** The colours of a tinted block of attribute rows: the title bar, the rows' background, labels and values. */
export type AttributesTint = Theme["fileAttributes"];

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
    labelWidth = LABEL_W,
    inset = true,
    lines = 1,
    labelColor: labelColorOverride,
    tint,
    truncate = "truncate-end",
}: FocusRowProps) {
    const theme = useTheme();
    const attribute = variant === "attribute";
    const colors = tint ?? theme.fileAttributes;
    const labelText = attribute ? label.toUpperCase().padStart(labelWidth) : label.toUpperCase().padEnd(labelWidth);
    const labelColor = isFocused
        ? theme.field.selected
        : (labelColorOverride ?? (attribute ? colors.label : theme.ui.border));
    return (
        <Box
            flexDirection="row"
            paddingX={1}
            marginX={attribute && inset ? 1 : 0}
            height={edit ? undefined : lines}
            flexShrink={0}
            backgroundColor={attribute ? colors.background : undefined}
        >
            <Box width={2} minWidth={2} flexShrink={0}>
                {isFocused && <Text color={theme.text.active}>{"☛"}</Text>}
            </Box>
            <Box width={labelWidth} minWidth={labelWidth} flexShrink={0} marginRight={1}>
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
                        color={valueColor ?? (attribute ? colors.value : theme.text.primary)}
                        bold={attribute}
                        dimColor={dim || value === "—"}
                        underline={isFocused}
                        wrap={lines > 1 ? "wrap" : truncate}
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

/**
 * The title bar of a block of attribute rows: yellow for "File attributes", `tint` for another block. With
 * `focusable` it is a row the cursor can reach (a switch): the pointer shows at the end of the bar.
 */
export function AttributesHeader({
    label,
    inset = true,
    tint,
    focusable = false,
    isFocused = false,
    badge,
}: {
    label: string;
    inset?: boolean;
    tint?: AttributesTint;
    focusable?: boolean;
    isFocused?: boolean;
    /** Small bold note at the right end of the bar. */
    badge?: { text: string; color: string };
}) {
    const theme = useTheme();
    const colors = tint ?? theme.fileAttributes;
    return (
        <Box
            flexDirection="row"
            paddingX={1}
            marginX={inset ? 1 : 0}
            height={1}
            flexShrink={0}
            overflow="hidden"
            backgroundColor={colors.header}
        >
            <Box flexGrow={1} flexShrink={1}>
                <Text color={colors.headerText} bold underline={isFocused} wrap="truncate-end">
                    {label}
                </Text>
            </Box>
            {/* The text stays where the other blocks' titles are: the pointer goes at the end of the bar. */}
            {focusable && isFocused && (
                <Box flexShrink={0} paddingLeft={1}>
                    <Text color={colors.headerText}>{"☚"}</Text>
                </Box>
            )}
            {badge && (
                <Box flexShrink={0} paddingLeft={1}>
                    <Text color={badge.color} bold>
                        {badge.text}
                    </Text>
                </Box>
            )}
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
