import { useEffect, useRef, type RefObject } from "react";
import type { DOMElement } from "ink";
import { isClickableWindow } from "#base/mouse/clickableWindows";
import { mouseRegistry, type MouseEvent } from "#base/mouse/mouse";
import { getScreenBounds } from "#base/mouse/screenBounds";
import type { Task } from "#base/task/task";
import { useFocusActions, useFocusChrome, useFocusTaskList } from "#contexts/FocusContext";

// Row layout shared with TaskRow and the header in TaskListPanel: paddingX={1}, then a
// 2-wide indicator box (cursor + multi-select check), then the columns.
const ROW_PADDING_X = 1;
const INDICATOR_WIDTH = 2;

/**
 * Pointer support for the task list: click a cell to select it (focusing the list),
 * click the header to focus a column header, click the indicator gutter or Ctrl+click
 * to toggle multi-select, Ctrl+Shift+click to select a range, and scroll the wheel to move the selection.
 */
export function useTaskListMouse({
    rowsRef,
    headerRef,
    columnWidths,
    offset,
    visibleRows,
    tasks,
    onCellClick,
}: {
    rowsRef: RefObject<DOMElement | null>;
    headerRef: RefObject<DOMElement | null>;
    columnWidths: number[];
    /** Index of the first rendered task. */
    offset: number;
    /** Number of task rows the viewport can show. */
    visibleRows: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tasks: Task<any>[];
    /** Plain left-click on a cell (not the gutter, not Ctrl+click); `xInCell` is 0 at the cell's left edge. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onCellClick?: (task: Task<any>, column: number, xInCell: number) => void;
}): void {
    const { activeWindow } = useFocusChrome();
    const { selectedTaskIndex, selectedColumnIndex } = useFocusTaskList();
    const { focusTaskListCell, scrollTaskList, toggleTaskSelection, selectTaskRange } = useFocusActions();

    // The subscription below is registered once; it reads the latest render's values from here.
    const latest = useRef({
        activeWindow,
        selectedTaskIndex,
        selectedColumnIndex,
        columnWidths,
        offset,
        visibleRows,
        tasks,
        onCellClick,
    });
    useEffect(() => {
        latest.current = {
            activeWindow,
            selectedTaskIndex,
            selectedColumnIndex,
            columnWidths,
            offset,
            visibleRows,
            tasks,
            onCellClick,
        };
    });

    useEffect(() => {
        const handle = (event: MouseEvent) => {
            if (event.type !== "press") return;
            const state = latest.current;
            if (!isClickableWindow(state.activeWindow)) return;

            const rows = getScreenBounds(rowsRef.current);
            const header = getScreenBounds(headerRef.current);
            if (!rows || !header) return;

            const renderedRows = Math.min(state.visibleRows, state.tasks.length - state.offset);
            const rowAtY = event.y - rows.y;
            const isOverRows =
                rowAtY >= 0 && rowAtY < renderedRows && event.x >= rows.x && event.x < rows.x + rows.width;

            if (event.button === "wheelUp" || event.button === "wheelDown") {
                const isOverList = isOverRows || (event.y === header.y && event.x >= header.x);
                if (isOverList) scrollTaskList(event.button === "wheelDown" ? 1 : -1);
                return;
            }
            if (event.button !== "left") return;

            const contentX = rows.x + ROW_PADDING_X;
            const columnsX = contentX + INDICATOR_WIDTH;
            const isOverIndicator = event.x >= contentX && event.x < columnsX;
            let column = -1;
            let cellLeft = columnsX;
            if (event.x >= columnsX) {
                let right = columnsX;
                for (let i = 0; i < state.columnWidths.length; i++) {
                    cellLeft = right;
                    right += state.columnWidths[i];
                    if (event.x < right) {
                        column = i;
                        break;
                    }
                }
            }
            const clickedCell = column !== -1;
            if (column === -1) column = state.selectedColumnIndex;

            if (event.y === header.y) {
                if (!isOverIndicator && event.x >= columnsX) focusTaskListCell("header", column);
                return;
            }
            if (!isOverRows || (event.x < columnsX && !isOverIndicator)) return;

            const index = state.offset + rowAtY;
            if (event.ctrl && event.shift) {
                selectTaskRange(
                    index,
                    state.tasks.map((t) => t.getId()),
                    column
                );
                return;
            }
            focusTaskListCell(index, column);
            if (isOverIndicator || event.ctrl) toggleTaskSelection(state.tasks[index].getId());
            else if (clickedCell) state.onCellClick?.(state.tasks[index], column, event.x - cellLeft);
        };
        return mouseRegistry.subscribe(handle);
    }, [rowsRef, headerRef, focusTaskListCell, scrollTaskList, toggleTaskSelection, selectTaskRange]);
}
