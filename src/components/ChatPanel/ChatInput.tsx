import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { textInputFocus } from "#base/textInputFocus";
import { MAX_INPUT_ROWS, layoutInput, sanitizeTyped } from "./inputLayout";

type Props = {
    value: string;
    onChange: (value: string) => void;
    onSubmit: (value: string) => void;
    /** Whether the line has the keyboard. */
    focus: boolean;
    placeholder?: string;
    /** Columns of the line. */
    width: number;
    /** Rows the line grows to before it scrolls. */
    maxRows?: number;
    /** Colour of the placeholder and of the text. */
    color?: string;
};

type Editing = { value: string; cursor: number };

/**
 * The chat's text line: what is typed wraps over a few rows (the line grows, then scrolls) and the cursor stays in
 * view, so a long message can be written and corrected. `ink-text-input` cannot do that: it draws the whole text on
 * one row, which spills out of a narrow panel.
 *
 * Like `ink-text-input` (see `#components/TextInput`) this is a text field that reads the keyboard itself, and tells
 * the app so with `textInputFocus`. It leaves every key that is a shortcut (Ctrl chords, Esc, Tab, ↑ ↓ PgUp PgDn)
 * to the shortcut registry. Editing keys: ← → move, Ctrl+A / Home start, Ctrl+E / End end, Ctrl+U clears what is
 * before the cursor, Backspace deletes.
 */
export const ChatInput: React.FC<Props> = ({
    value,
    onChange,
    onSubmit,
    focus,
    placeholder = "",
    width,
    maxRows = MAX_INPUT_ROWS,
    color,
}) => {
    const [editing, setEditing] = useState<Editing>({ value, cursor: Array.from(value).length });
    // The newest state, for keys that arrive before the next render.
    const latest = useRef(editing);
    useEffect(() => {
        latest.current = editing;
    });

    // The text was changed from outside (cleared after a send, a paste routed here): the cursor goes to its end.
    if (editing.value !== value) {
        setEditing({ value, cursor: Array.from(value).length });
    }

    useEffect(() => (focus ? textInputFocus.acquire() : undefined), [focus]);

    useInput(
        (input, key) => {
            const cur = latest.current;
            const chars = Array.from(cur.value);
            let next: Editing = cur;

            if (key.return) {
                onSubmit(cur.value);
                return;
            }
            if (key.ctrl || key.meta) {
                if (key.ctrl && input === "a") next = { ...cur, cursor: 0 };
                else if (key.ctrl && input === "e") next = { ...cur, cursor: chars.length };
                else if (key.ctrl && input === "u") {
                    next = { value: chars.slice(cur.cursor).join(""), cursor: 0 };
                } else return;
            } else if ((key.leftArrow || key.rightArrow) && key.shift) {
                // Shift+←/→ resizes the panel (a shortcut).
                return;
            } else if (key.leftArrow) {
                next = { ...cur, cursor: Math.max(0, cur.cursor - 1) };
            } else if (key.rightArrow) {
                next = { ...cur, cursor: Math.min(chars.length, cur.cursor + 1) };
            } else if (key.home) {
                next = { ...cur, cursor: 0 };
            } else if (key.end) {
                next = { ...cur, cursor: chars.length };
            } else if (key.backspace || key.delete) {
                if (cur.cursor === 0) return;
                chars.splice(cur.cursor - 1, 1);
                next = { value: chars.join(""), cursor: cur.cursor - 1 };
            } else if (key.upArrow || key.downArrow || key.pageUp || key.pageDown || key.tab || key.escape) {
                return;
            } else {
                const typed = sanitizeTyped(input);
                if (typed === "") return;
                const added = Array.from(typed);
                chars.splice(cur.cursor, 0, ...added);
                next = { value: chars.join(""), cursor: cur.cursor + added.length };
            }

            latest.current = next;
            setEditing(next);
            if (next.value !== cur.value) onChange(next.value);
        },
        { isActive: focus }
    );

    // The first character of the placeholder is the cursor while the line is empty.
    if (value === "") {
        const first = Array.from(placeholder)[0];
        return (
            <Box width={width} height={1} flexShrink={0} overflow="hidden">
                {focus ? <Text inverse>{first ?? " "}</Text> : null}
                <Text dimColor wrap="truncate-end">
                    {focus ? Array.from(placeholder).slice(1).join("") : placeholder}
                </Text>
            </Box>
        );
    }

    const rows = layoutInput(value, focus ? editing.cursor : Array.from(value).length, width, maxRows);
    return (
        <Box flexDirection="column" width={width} height={rows.length} flexShrink={0} overflow="hidden">
            {rows.map((row, i) => (
                <Box key={i} width={width} height={1} flexShrink={0} overflow="hidden">
                    <Text color={color} wrap="truncate">
                        {row.before}
                        {row.cursor !== "" && focus ? <Text inverse>{row.cursor}</Text> : row.cursor}
                        {row.after}
                    </Text>
                </Box>
            ))}
        </Box>
    );
};
