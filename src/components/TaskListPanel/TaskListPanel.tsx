import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { Task, TaskSnapshot } from "#base/task/task";
import { FlowBase } from "#base/flow/flow-base";
import { useTheme } from "#base/themeContext";
import { useFocusChrome, useFocusTaskList } from "#contexts/FocusContext";
import { Shortcut, ContextualActions, ContextualActionBar } from "#types/actions";
import { ActionBar } from "./ActionBar";
import { DynamicHintBar } from "#components/DynamicHintBar/DynamicHintBar";
import { TaskRow } from "./TaskRow";
import { useTaskHeaderShortcuts } from "#hooks/useKeyHandlers";
import { globalLogger } from "#base/logger/logger";

export type { Shortcut, ContextualActions, ContextualActionBar };

export type ColumnComponentProps<TAttributes> = {
    task: TaskSnapshot<TAttributes>;
    taskReference: Task<TAttributes>;
    width: number;
    isSelected: boolean;
    flow: FlowBase;
};

// React.ComponentType accepts both plain function components and React.memo-wrapped ones.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ColumnComponent<TAttributes = any> = React.ComponentType<ColumnComponentProps<TAttributes>>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ColumnDefinition<TAttributes = any> = {
    id: string;
    label: string;
    /** Short fallback shown in the header when `label` doesn't fit the column width. */
    acronym?: string;
    color?: React.ComponentProps<typeof Text>["color"];
    weight: number;
    minWidth?: number;
    flexGrow?: number;
    widthRatio?: number; // fraction of available width (0–1); overrides weight when set
    resizable?: boolean; // default true; false = resize shortcuts have no effect
    component: ColumnComponent<TAttributes>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CalculatedColumn<TAttributes = any> = ColumnDefinition<TAttributes> & {
    width: number;
};

export function calculateColumnWidths<TAttributes>(
    columns: ColumnDefinition<TAttributes>[],
    totalWidth: number
): CalculatedColumn<TAttributes>[] {
    const reservedWidth = 6; // 2 (L+R border) + 2 (row paddingX) + 2 (indicator box)
    const availableWidth = totalWidth - reservedWidth;

    const columnsWithMin = columns.map((col) => ({
        ...col,
        minWidth: col.minWidth ?? Math.max(2, col.label.length + 3),
    }));

    const totalWeight = columnsWithMin.reduce((sum, col) => sum + col.weight, 0);
    const totalMinWidth = columnsWithMin.reduce((sum, col) => sum + col.minWidth!, 0);

    const remainingWidth = Math.max(0, availableWidth - totalMinWidth);

    const columnsWithBase = columnsWithMin.map((col) => {
        const baseWidth = col.minWidth!;
        const additionalWidth = totalWeight > 0 ? Math.floor((remainingWidth * col.weight) / totalWeight) : 0;

        return {
            ...col,
            baseWidth: baseWidth + additionalWidth,
            hasFlexGrow: (col.flexGrow ?? 0) > 0,
        };
    });

    const usedWidth = columnsWithBase.reduce((sum, col) => sum + col.baseWidth, 0);
    const leftoverWidth = availableWidth - usedWidth;

    const totalFlexGrow = columnsWithBase
        .filter((col) => col.hasFlexGrow)
        .reduce((sum, col) => sum + (col.flexGrow ?? 0), 0);

    return columnsWithBase.map((col) => {
        let width = col.baseWidth;

        if (col.hasFlexGrow && totalFlexGrow > 0 && leftoverWidth > 0) {
            const flexRatio = (col.flexGrow ?? 0) / totalFlexGrow;
            width += Math.floor(leftoverWidth * flexRatio);
        }

        // Spread preserves all ColumnDefinition fields (resizable, widthRatio, color, etc.)
        return { ...col, width };
    });
}

export const TaskListPanel: React.FC<{
    columns: ColumnDefinition[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tasks: Task<any>[];
    width: number;
    flow: FlowBase;
}> = ({ columns, tasks, width, flow }) => {
    const theme = useTheme();
    const { activeWindow, layout } = useFocusChrome();
    const taskListFocus = useFocusTaskList();
    const isWindowActive = activeWindow === "taskList";
    const fullHeight = layout.taskListHeight;
    const actionBarRows = isWindowActive ? 2 : 0;
    const height = fullHeight - 1 - actionBarRows; // subtract header and action bar

    // Calculate scroll offset so the selected task stays visible (center when possible)
    const selectedIndex = taskListFocus.selectedTaskIndex;
    const taskCount = tasks.length;
    const maxOffset = Math.max(0, taskCount - height);

    // Center using (height - 1)/2 to avoid off-by-one shifts for even heights,
    // then clamp to [0, maxOffset].
    const desiredCenterOffset = selectedIndex - Math.floor((height - 1) / 2);
    const offset = Math.max(0, Math.min(desiredCenterOffset, maxOffset));

    const RESERVED_WIDTH = 6; // must match reservedWidth in calculateColumnWidths
    const calculatedColumns = useMemo(() => {
        const availableWidth = width - RESERVED_WIDTH;
        // When a column has an explicit minWidth or an acronym fallback, use that for space
        // reservation — avoids inflating layout when label is the long display form.
        const naturalMins = columns.map((col) => {
            if (col.minWidth !== undefined) return col.minWidth;
            const displayLen = col.acronym !== undefined ? col.acronym.length : col.label.length;
            return Math.max(2, displayLen + 3);
        });
        const totalNaturalMin = naturalMins.reduce((s, m) => s + m, 0);

        // Ratios are stored relative to resizableWidth (excludes fixed non-resizable columns)
        // so they scale correctly when the terminal is resized.
        const fixedWidth = columns.reduce((s, col, i) => (col.resizable === false ? s + naturalMins[i] : s), 0);
        const resizableWidth = Math.max(1, availableWidth - fixedWidth);

        // Compute floor-based widths for all ratio columns, then fill rounding leftover
        // using largest-remainder so their widths sum exactly to ratioAvailableWidth.
        const ratioIndices = columns
            .map((_, i) => i)
            .filter((i) => columns[i].widthRatio !== undefined && columns[i].resizable !== false);
        // Reserve natural-minimum space for resizable columns that have no stored ratio
        // (e.g. a provider column that only exists in the other display mode).
        // Without this, ratio columns would fill all of resizableWidth and leave no room for them.
        const nonRatioResizableMin = columns.reduce(
            (s, col, i) => (col.resizable !== false && col.widthRatio === undefined ? s + naturalMins[i] : s),
            0
        );
        const ratioAvailableWidth = Math.max(0, resizableWidth - nonRatioResizableMin);
        // Normalize ratios before scaling so their sum is always exactly 1.0 — guards against
        // manually-edited or migrated settings where ratios don't sum to 1.
        const totalRatio = ratioIndices.reduce((s, i) => s + columns[i].widthRatio!, 0);
        const normalize = totalRatio > 0 ? 1 / totalRatio : 1;
        const floatWidths = ratioIndices.map((i) => ratioAvailableWidth * columns[i].widthRatio! * normalize);
        const floorWidths = floatWidths.map((f) => Math.floor(f));
        let leftover = ratioAvailableWidth - floorWidths.reduce((s, w) => s + w, 0);
        floatWidths
            .map((f, k) => ({ k, frac: f - Math.floor(f) }))
            .sort((a, b) => b.frac - a.frac)
            .forEach(({ k }) => {
                if (leftover <= 0) return;
                floorWidths[k]++;
                leftover--;
            });
        const exactWidths = new Map(ratioIndices.map((colIdx, k) => [colIdx, floorWidths[k]]));

        const resolved = columns.map((col, i) => {
            const exact = exactWidths.get(i);
            if (exact !== undefined) {
                const naturalMin = naturalMins[i];
                const minW = col.minWidth !== undefined ? Math.max(col.minWidth, naturalMin) : naturalMin;
                // Cap so that every other column can still reach its natural minimum
                const maxWidth = Math.max(minW, availableWidth - (totalNaturalMin - naturalMin));
                return { ...col, minWidth: Math.min(maxWidth, Math.max(minW, exact)), weight: 0 };
            }
            return col;
        });
        return calculateColumnWidths(resolved, width);
    }, [columns, width]);

    const selectedColIndex = taskListFocus.selectedColumnIndex;
    // Use original columns prop (not calculatedColumns) — calculateColumnWidths output may drop fields
    const isColumnResizable = columns[selectedColIndex]?.resizable !== false;

    const RESIZE_STEP = 4;
    const selectedColumnLabel = calculatedColumns[selectedColIndex]?.label ?? "";
    useTaskHeaderShortcuts(isColumnResizable, selectedColumnLabel, (direction) => {
        const col = calculatedColumns[selectedColIndex];
        if (!col) return;
        const availableWidth = width - RESERVED_WIDTH;
        const colNatMin = (c: CalculatedColumn) => Math.max(2, c.label.length + 4);
        const naturalMin = colNatMin(col);

        // Use right columns; fall back to left columns when on the last resizable column
        const rightCols = calculatedColumns
            .map((c, i) => ({ c, i }))
            .filter(({ i }) => i > selectedColIndex && columns[i]?.resizable !== false)
            .map(({ c }) => c);
        const leftCols = calculatedColumns
            .map((c, i) => ({ c, i }))
            .filter(({ i }) => i < selectedColIndex && columns[i]?.resizable !== false)
            .map(({ c }) => c);
        const adjacentCols = rightCols.length > 0 ? rightCols : leftCols;

        // Distribute `total` pixels across columns by weight using largest-remainder (no last-col bias).
        const distributePixels = (total: number, weights: number[]): number[] => {
            const sum = weights.reduce((s, w) => s + w, 0);
            const floats = weights.map((w) => (sum > 0 ? (total * w) / sum : total / weights.length));
            const floors = floats.map((f) => Math.floor(f));
            let remaining = total - floors.reduce((s, f) => s + f, 0);
            const order = floats.map((f, i) => ({ i, frac: f - Math.floor(f) })).sort((a, b) => b.frac - a.frac);
            for (const { i } of order) {
                if (remaining <= 0) break;
                floors[i]++;
                remaining--;
            }
            return floors;
        };

        let newSelectedWidth: number;
        const newAdjacentWidths: Record<string, number> = {};

        if (direction === "right") {
            // Grow: take from adjacent columns proportionally by current width, capped by slack
            const slacks = adjacentCols.map((c) => Math.max(0, c.width - colNatMin(c)));
            const totalSlack = slacks.reduce((s, v) => s + v, 0);
            const target = Math.min(RESIZE_STEP, totalSlack);
            if (target === 0) return;

            // Initial distribution; cap each by its slack
            let takes = distributePixels(
                target,
                adjacentCols.map((c) => c.width)
            ).map((t, i) => Math.min(t, slacks[i]));
            // Redistribute any shortfall caused by slack caps
            const shortfall = target - takes.reduce((s, t) => s + t, 0);
            if (shortfall > 0) {
                const remainSlacks = adjacentCols.map((_, i) => Math.max(0, slacks[i] - takes[i]));
                const extra = distributePixels(shortfall, remainSlacks).map((t, i) => Math.min(t, remainSlacks[i]));
                takes = takes.map((t, i) => t + extra[i]);
            }
            adjacentCols.forEach((c, i) => {
                newAdjacentWidths[c.id] = c.width - takes[i];
            });
            newSelectedWidth = col.width + takes.reduce((s, t) => s + t, 0);
        } else {
            // Shrink: give freed space to adjacent columns proportionally by current width
            newSelectedWidth = Math.max(naturalMin, col.width - RESIZE_STEP);
            const freed = col.width - newSelectedWidth;
            if (freed === 0) return;

            const shares = distributePixels(
                freed,
                adjacentCols.map((c) => c.width)
            );
            adjacentCols.forEach((c, i) => {
                newAdjacentWidths[c.id] = c.width + shares[i];
            });
        }

        // // Log per-column pixel delta for this resize step
        // const deltaLog = calculatedColumns
        //     .filter((_, i) => columns[i]?.resizable !== false)
        //     .map((c) => {
        //         const newW = c.id === col.id ? newSelectedWidth : (newAdjacentWidths[c.id] ?? c.width);
        //         const delta = newW - c.width;
        //         return `${c.id}:${delta > 0 ? "+" : ""}${delta}`;
        //     })
        //     .join(" | ");
        // globalLogger.info(`resize ${direction}: ${deltaLog}`);

        // Ratios are stored relative to resizableWidth (not availableWidth) so they scale
        // correctly when the terminal is resized — fixed columns keep their natural min.
        const fixedWidth = calculatedColumns
            .filter((_, i) => columns[i]?.resizable === false)
            .reduce((s, c) => s + c.width, 0);
        const resizableWidth = Math.max(1, availableWidth - fixedWidth);

        const allRatios: Record<string, number> = {};
        calculatedColumns.forEach((c, i) => {
            if (columns[i]?.resizable === false) return;
            const w =
                i === selectedColIndex
                    ? newSelectedWidth
                    : newAdjacentWidths[c.id] !== undefined
                      ? newAdjacentWidths[c.id]
                      : c.width;
            allRatios[c.id] = w / resizableWidth;
        });
        flow.setColumnRatios(allRatios);
    });

    return (
        <Box
            borderStyle="single"
            borderColor={theme.ui.border}
            borderBackgroundColor={theme.ui.background}
            flexDirection="column"
            overflow="hidden"
            borderTop={false}
            borderBottom={false}
            height={fullHeight}
            flexGrow={1}
        >
            {/* Column headers */}
            <Box flexDirection="row" paddingX={1} height={1} overflow="hidden" flexShrink={0}>
                <Box width={2} height={1} flexShrink={0} />
                {calculatedColumns.map((column, index) => {
                    const isActive =
                        isWindowActive && taskListFocus.isHeaderFocused && taskListFocus.selectedColumnIndex === index;
                    return (
                        <Box
                            key={`header-${column.id}-${index}`}
                            width={column.width}
                            minWidth={column.width}
                            maxWidth={column.width}
                            height={1}
                            paddingX={1}
                            overflow="hidden"
                            flexShrink={0}
                            backgroundColor={isActive ? theme.ui.rowBackground.regular.cellActive : undefined}
                        >
                            <Text bold color={isActive ? "white" : column.color || "cyan"}>
                                {column.acronym && column.label.length > column.width - 2
                                    ? column.acronym
                                    : column.label}
                            </Text>
                        </Box>
                    );
                })}
            </Box>

            {/* Task rows */}
            <Box flexDirection="column" height={height} overflow="hidden" flexGrow={1}>
                {tasks.length === 0 ? (
                    <Box paddingX={4} overflow="hidden">
                        <Text italic color={"gray"}>
                            Press Ctrl+V to import music URLs
                        </Text>
                    </Box>
                ) : (
                    tasks.slice(offset, offset + height).map((task, index) => {
                        const visibleIndex = index + offset;
                        const isRowHighlighted = selectedIndex === visibleIndex;
                        const isRowActive =
                            isWindowActive && !taskListFocus.isHeaderFocused && selectedIndex === visibleIndex;
                        const selectedColumnIndex = isRowActive ? taskListFocus.selectedColumnIndex : -1;
                        const isMultiSelected = taskListFocus.selectedTaskIds.has(task.getId());
                        return (
                            <TaskRow
                                key={task.getId()}
                                taskReference={task}
                                isHighlighted={isRowHighlighted}
                                isActive={isRowActive}
                                isMultiSelected={isMultiSelected}
                                selectedColumnIndex={selectedColumnIndex}
                                columns={calculatedColumns}
                                flow={flow}
                            />
                        );
                    })
                )}
            </Box>

            {/* Shortcut hints */}
            {isWindowActive && taskListFocus.isHeaderFocused ? (
                <DynamicHintBar width={width - 2} isActive={true} />
            ) : (
                <ActionBar tasks={tasks} flow={flow} />
            )}
        </Box>
    );
};
