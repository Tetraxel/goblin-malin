/**
 * Which items of a list taller than its box to draw, so the item the cursor is on stays in view.
 *
 * `heights[i]` is how many terminal lines item `i` takes. The window starts from where it was
 * (`prevStart`) and only moves as far as needed: down until the focused item fits at the bottom, or up
 * to the focused item if it is above. If the list ends before the box does, the window is pulled back
 * up to use the room. Returns the half-open range `[start, end)`.
 */
export function computeWindow(
    heights: number[],
    focusIndex: number,
    prevStart: number,
    available: number
): { start: number; end: number } {
    if (heights.length === 0) return { start: 0, end: 0 };
    const focus = Math.max(0, Math.min(focusIndex, heights.length - 1));

    let start = Math.max(0, Math.min(prevStart, focus));
    let used = 0;
    for (let i = start; i <= focus; i++) used += heights[i];
    while (used > available && start < focus) {
        used -= heights[start];
        start++;
    }

    let end = focus + 1;
    while (end < heights.length && used + heights[end] <= available) {
        used += heights[end];
        end++;
    }
    while (start > 0 && used + heights[start - 1] <= available) {
        start--;
        used += heights[start];
    }
    return { start, end };
}
