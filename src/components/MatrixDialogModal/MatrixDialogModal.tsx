import React, { useEffect, useRef, useState } from "react";
import { Box, Text, type DOMElement } from "ink";
import { useClickTarget } from "#base/mouse/useMouseTarget";
import { useShortcuts } from "#hooks/useShortcuts";
import { useFocusActions, useFocusChrome } from "#contexts/FocusContext";
import { useTheme } from "#base/themeContext";
import { type MatrixAnswer, type MatrixDialog, type MatrixItem } from "#base/bridges/dialogBridge";
import { Hint } from "../Hint";
import { wrapText } from "#utils/wrapText";

export type PendingMatrixDialog = {
    dialog: MatrixDialog;
    resolve: (answer: MatrixAnswer) => void;
};

interface MatrixDialogModalProps {
    pending: PendingMatrixDialog | null;
    terminalHeight: number;
    terminalWidth: number;
    onAnswer: (answer: MatrixAnswer) => void;
}

/** Width of the cursor and the box before each label: `☛ [✓] `. */
const LEAD = 6;
/** The most detail lines shown for the item under the cursor. */
const MAX_DETAIL = 3;

/** The columns come first in the cursor's order, then the rows. */
type Cursor = { section: "columns" | "rows"; index: number };

function cursorAt(position: number, columnCount: number): Cursor {
    return position < columnCount
        ? { section: "columns", index: position }
        : { section: "rows", index: position - columnCount };
}

/** One tickable line: the cursor, the box and the label in its color; a click ticks it. */
function ItemLine({
    item,
    checked,
    selected,
    labelWidth,
    onToggle,
    children,
}: {
    item: MatrixItem;
    checked: boolean;
    selected: boolean;
    labelWidth: number;
    onToggle: () => void;
    children?: React.ReactNode;
}) {
    const theme = useTheme();
    const ref = useRef<DOMElement>(null);
    // Only while this dialog is the focused window: it must not react to the app underneath.
    useClickTarget(ref, onToggle, { window: "matrixDialog" });
    return (
        <Box ref={ref} flexDirection="row" flexShrink={0}>
            <Box width={2} flexShrink={0}>
                <Text color={theme.ui.focusIndicator}>{selected ? "☛" : ""}</Text>
            </Box>
            <Box width={4} flexShrink={0}>
                <Text color={checked ? theme.status.success : theme.text.secondary}>{checked ? "[✓]" : "[ ]"}</Text>
            </Box>
            <Box width={labelWidth + 2} flexShrink={0}>
                <Text
                    bold={selected}
                    color={checked ? (item.color ?? theme.text.primary) : theme.text.secondary}
                    wrap="truncate-end"
                >
                    {item.label}
                </Text>
            </Box>
            {children}
        </Box>
    );
}

/**
 * Two sets of things to tick on one screen, opened through `dialogBridge.matrix` (the first-run provider picker):
 * the columns, each followed by the rows it takes in their own colors, then a grid of every row against every column.
 * A strong cell is in its row's color only while both ends are ticked, so what will really be used stands out and what
 * is lost by unticking something turns grey at once. The details of the item under the cursor are shown below.
 *
 * The toggle key (Enter) ticks the item under the cursor, the save key answers every value, Esc dismisses.
 */
export const MatrixDialogModal: React.FC<MatrixDialogModalProps> = ({
    pending,
    terminalHeight,
    terminalWidth,
    onAnswer,
}) => {
    const theme = useTheme();
    const { switchWindow, switchBack } = useFocusActions();
    const { activeWindow } = useFocusChrome();
    const [position, setPosition] = useState(0);
    const [rowChecks, setRowChecks] = useState<boolean[]>([]);
    const [columnChecks, setColumnChecks] = useState<boolean[]>([]);

    const [prevPending, setPrevPending] = useState(pending);
    if (prevPending !== pending) {
        setPrevPending(pending);
        setPosition(0);
        setRowChecks(pending?.dialog.rows.items.map((item) => item.checked) ?? []);
        setColumnChecks(pending?.dialog.columns.items.map((item) => item.checked) ?? []);
    }

    useEffect(() => {
        if (!pending) return;
        switchWindow("matrixDialog");
        return () => {
            switchBack();
        };
    }, [pending, switchWindow, switchBack]);

    const dialog = pending?.dialog;
    const columns = dialog?.columns.items ?? [];
    const rows = dialog?.rows.items ?? [];
    const count = columns.length + rows.length;
    const isActive = pending !== null && activeWindow === "matrixDialog";

    const toggle = (cursor: Cursor) => {
        const flip = (values: boolean[]) => values.map((value, i) => (i === cursor.index ? !value : value));
        if (cursor.section === "columns") setColumnChecks(flip);
        else setRowChecks(flip);
    };

    useShortcuts({
        id: "matrixDialog",
        isActive,
        exclusive: true,
        priority: 300,
        shortcuts: [
            {
                id: "matrixDialog.up",
                defaultShortcut: { key: "upArrow" },
                label: "Up",
                handler: () => setPosition((p) => (count === 0 ? 0 : (p - 1 + count) % count)),
            },
            {
                id: "matrixDialog.down",
                defaultShortcut: { key: "downArrow" },
                label: "Down",
                handler: () => setPosition((p) => (count === 0 ? 0 : (p + 1) % count)),
            },
            {
                id: "matrixDialog.toggle",
                defaultShortcut: { key: "return" },
                label: "Tick",
                handler: () => {
                    if (count > 0) toggle(cursorAt(position, columns.length));
                },
            },
            {
                id: "matrixDialog.confirm",
                defaultShortcut: { input: "s", ctrl: true },
                label: "Save",
                handler: () => {
                    if (!dialog) return;
                    onAnswer({
                        rows: rows.map((_, i) => rowChecks[i] === true),
                        columns: columns.map((_, i) => columnChecks[i] === true),
                    });
                },
            },
            {
                id: "matrixDialog.cancel",
                defaultShortcut: { key: "escape" },
                label: "Cancel",
                handler: () => onAnswer(null),
            },
        ],
    });

    if (!pending || !dialog) return null;

    const accent = dialog.accent ?? theme.ui.modalBorder;
    const modalWidth = Math.min(100, Math.max(44, terminalWidth - 8));
    const cursor = cursorAt(position, columns.length);
    // One lookup per cell, not a scan of every cell for each of them. The key's separator is written as an escape:
    // a raw control character would make git treat the file as binary.
    const pairKey = (row: string, column: string) => `${row}\u0000${column}`;
    const cellByPair = new Map(dialog.cells.map((cell) => [pairKey(cell.row, cell.column), cell]));
    const cellOf = (row: string, column: string) => cellByPair.get(pairKey(row, column));

    // Wide enough for every label, and for the rows' heading over them (it starts under the cursor's column).
    const labelWidth = Math.max(
        ...columns.map((c) => c.label.length),
        ...rows.map((r) => r.label.length),
        dialog.rows.heading.length - (LEAD - 2)
    );
    const cellWidths = columns.map((column) =>
        Math.max(
            column.label.length,
            ...dialog.cells.filter((c) => c.column === column.key).map((c) => c.mark.length),
            1
        )
    );

    // The item under the cursor: its details are shown under the grid, in a box as tall as the longest one needs.
    const current = cursor.section === "columns" ? columns[cursor.index] : rows[cursor.index];
    const detailHeight = Math.min(MAX_DETAIL, Math.max(0, ...[...columns, ...rows].map((i) => i.detail?.length ?? 0)));

    // What the frame takes around the grid's rows: border + padding (4), title (1), intro (margin + its lines), the
    // columns' heading and lines (margin + 1 + n), the grid's header (margin + 1), the details (margin + n), the hints
    // (margin + 1). The grid scrolls when the terminal is shorter than that.
    const textWidth = modalWidth - 6;
    // Wrapped here, between words, so its height is known exactly and no line starts with a space.
    const intro = dialog.intro ? wrapText(dialog.intro, textWidth, Number.MAX_SAFE_INTEGER) : [];
    const chromeWithout = 4 + 1 + 2 + columns.length + 2 + 2 + 2;
    const rowsFit = (withIntro: boolean, withDetail: boolean) =>
        terminalHeight - chromeWithout - (withIntro ? 1 + intro.length : 0) - (withDetail ? 1 + detailHeight : 0);
    // The grid is the point of the screen: on a short terminal the intro goes first, then the details, so every row
    // can be seen at once (only when even that is not enough does the grid scroll).
    let showIntro = intro.length > 0;
    let showDetail = detailHeight > 0;
    if (showIntro && rowsFit(showIntro, showDetail) < rows.length) showIntro = false;
    if (showDetail && rowsFit(showIntro, showDetail) < Math.min(rows.length, 3)) showDetail = false;
    if (showDetail && rowsFit(showIntro, false) >= rows.length && rowsFit(showIntro, true) < rows.length) {
        showDetail = false;
    }
    let budget = rowsFit(showIntro, showDetail);
    // At least one row is always drawn: the cursor's (a list of "more" markers alone would be toggled blind).
    budget = Math.max(3, budget);
    // When the rows do not fit, a line goes to each "more" marker.
    const visibleCount = rows.length > budget ? budget - 2 : rows.length;
    let first = 0;
    if (rows.length > budget) {
        // Keep the cursor's row in view.
        const target = cursor.section === "rows" ? cursor.index : 0;
        first = Math.max(0, Math.min(target - visibleCount + 1, rows.length - visibleCount));
    }
    const shownRows = rows.slice(first, first + visibleCount);

    return (
        <Box
            position="absolute"
            width="100%"
            height={terminalHeight}
            flexDirection="column"
            justifyContent="center"
            alignItems="center"
        >
            <Box width="100%" justifyContent="center">
                <Box
                    flexDirection="column"
                    borderStyle="round"
                    borderColor={accent}
                    borderBackgroundColor={theme.ui.background}
                    backgroundColor={theme.ui.background}
                    paddingX={2}
                    paddingY={1}
                    width={modalWidth}
                    flexShrink={0}
                >
                    <Text bold color={accent}>
                        {dialog.title}
                    </Text>
                    {showIntro && (
                        <Box marginTop={1} flexDirection="column" flexShrink={0}>
                            {intro.map((line, i) => (
                                <Text key={i}>{line}</Text>
                            ))}
                        </Box>
                    )}

                    {/* The columns, each with the rows it takes. */}
                    <Box marginTop={1} flexDirection="column" flexShrink={0}>
                        <Box marginLeft={2} flexShrink={0}>
                            <Text bold color={theme.text.secondary}>
                                {dialog.columns.heading}
                            </Text>
                        </Box>
                        {columns.map((column, c) => {
                            const fed = rows
                                .map((row, r) => ({ row, r, cell: cellOf(row.key, column.key) }))
                                .filter(({ cell }) => cell?.strong);
                            const on = columnChecks[c] === true;
                            return (
                                <ItemLine
                                    key={column.key}
                                    item={column}
                                    checked={on}
                                    selected={cursor.section === "columns" && cursor.index === c}
                                    labelWidth={labelWidth}
                                    onToggle={() => {
                                        setPosition(c);
                                        toggle({ section: "columns", index: c });
                                    }}
                                >
                                    {fed.length > 0 ? (
                                        <Text wrap="truncate-end">
                                            {dialog.columnLinksLabel && (
                                                <Text color={theme.text.secondary}>{dialog.columnLinksLabel} </Text>
                                            )}
                                            {fed.map(({ row, r }, n) => {
                                                const used = on && rowChecks[r] === true;
                                                return (
                                                    <React.Fragment key={row.key}>
                                                        {n > 0 && <Text color={theme.text.secondary}> · </Text>}
                                                        <Text
                                                            color={
                                                                used
                                                                    ? (row.color ?? theme.text.primary)
                                                                    : theme.text.secondary
                                                            }
                                                            bold={used}
                                                            strikethrough={rowChecks[r] !== true}
                                                        >
                                                            {row.label}
                                                        </Text>
                                                    </React.Fragment>
                                                );
                                            })}
                                        </Text>
                                    ) : (
                                        column.note && (
                                            <Text color={theme.text.secondary} wrap="truncate-end">
                                                {column.note}
                                            </Text>
                                        )
                                    )}
                                </ItemLine>
                            );
                        })}
                    </Box>

                    {/* The grid: every row against every column. */}
                    <Box marginTop={1} flexDirection="column" flexShrink={0}>
                        <Box flexDirection="row" flexShrink={0}>
                            <Box marginLeft={2} width={LEAD - 2 + labelWidth + 2} flexShrink={0}>
                                <Text bold color={theme.text.secondary} wrap="truncate-end">
                                    {dialog.rows.heading}
                                </Text>
                            </Box>
                            {columns.map((column, c) => (
                                <Box key={column.key} width={cellWidths[c] + 2} flexShrink={0}>
                                    <Text
                                        bold
                                        color={
                                            columnChecks[c]
                                                ? (column.color ?? theme.text.primary)
                                                : theme.text.secondary
                                        }
                                        strikethrough={!columnChecks[c]}
                                        wrap="truncate-end"
                                    >
                                        {column.label}
                                    </Text>
                                </Box>
                            ))}
                        </Box>
                        {first > 0 && (
                            <Box marginLeft={LEAD} flexShrink={0}>
                                <Text color={theme.text.secondary}>↑ more</Text>
                            </Box>
                        )}
                        {shownRows.map((row, offset) => {
                            const r = first + offset;
                            const rowOn = rowChecks[r] === true;
                            return (
                                <ItemLine
                                    key={row.key}
                                    item={row}
                                    checked={rowOn}
                                    selected={cursor.section === "rows" && cursor.index === r}
                                    labelWidth={labelWidth}
                                    onToggle={() => {
                                        setPosition(columns.length + r);
                                        toggle({ section: "rows", index: r });
                                    }}
                                >
                                    {columns.map((column, c) => {
                                        const cell = cellOf(row.key, column.key);
                                        const used = rowOn && columnChecks[c] === true;
                                        const color =
                                            !cell || !used
                                                ? theme.text.secondary
                                                : cell.strong
                                                  ? (row.color ?? theme.text.primary)
                                                  : theme.text.primary;
                                        return (
                                            <Box key={column.key} width={cellWidths[c] + 2} flexShrink={0}>
                                                <Text color={color} bold={!!cell?.strong && used} wrap="truncate-end">
                                                    {cell ? cell.mark : "·"}
                                                </Text>
                                            </Box>
                                        );
                                    })}
                                </ItemLine>
                            );
                        })}
                        {first + visibleCount < rows.length && (
                            <Box marginLeft={LEAD} flexShrink={0}>
                                <Text color={theme.text.secondary}>↓ more</Text>
                            </Box>
                        )}
                    </Box>

                    {showDetail && (
                        <Box marginTop={1} flexDirection="column" height={detailHeight} flexShrink={0}>
                            {(current?.detail ?? []).slice(0, detailHeight).map((line, d) => (
                                <Text key={d} color={theme.text.secondary} wrap="truncate-end">
                                    {line}
                                </Text>
                            ))}
                        </Box>
                    )}

                    <Box marginTop={1} flexDirection="row">
                        <Hint label="Tick" shortcutId="matrixDialog.toggle" />
                        <Hint label={dialog.confirmLabel ?? "Save"} shortcutId="matrixDialog.confirm" />
                        <Hint label="Select" shortcutIds={["matrixDialog.up", "matrixDialog.down"]} />
                        <Hint label="Cancel" shortcutId="matrixDialog.cancel" />
                    </Box>
                </Box>
            </Box>
        </Box>
    );
};
