import type { DOMElement } from "ink";

type Rect = { x: number; y: number; width: number; height: number };

/**
 * Absolute screen position of an Ink element. Yoga reports each node's offset
 * relative to its parent, so walk up and sum. Only meaningful after layout —
 * call it from event handlers/effects, not during render.
 */
export function getScreenBounds(node: DOMElement | null): Rect | null {
    if (!node?.yogaNode) return null;
    let x = 0;
    let y = 0;
    for (let current: DOMElement | undefined = node; current; current = current.parentNode) {
        if (!current.yogaNode) return null;
        x += current.yogaNode.getComputedLeft();
        y += current.yogaNode.getComputedTop();
    }
    return { x, y, width: node.yogaNode.getComputedWidth(), height: node.yogaNode.getComputedHeight() };
}

/**
 * Like `getScreenBounds`, but cut down to the part that is actually painted: rows pushed
 * past an `overflow="hidden"` ancestor keep their Yoga position, so without this a click on
 * whatever sits below the panel would land on a row that isn't visible.
 */
export function getVisibleScreenBounds(node: DOMElement | null): Rect | null {
    const bounds = getScreenBounds(node);
    if (!node || !bounds) return null;
    let left = bounds.x;
    let top = bounds.y;
    let right = bounds.x + bounds.width;
    let bottom = bounds.y + bounds.height;
    for (let ancestor = node.parentNode; ancestor; ancestor = ancestor.parentNode) {
        const { overflow, overflowX, overflowY } = ancestor.style;
        const clipsX = (overflowX ?? overflow) === "hidden";
        const clipsY = (overflowY ?? overflow) === "hidden";
        if (!clipsX && !clipsY) continue;
        const clip = getScreenBounds(ancestor);
        if (!clip) return null;
        if (clipsX) {
            left = Math.max(left, clip.x);
            right = Math.min(right, clip.x + clip.width);
        }
        if (clipsY) {
            top = Math.max(top, clip.y);
            bottom = Math.min(bottom, clip.y + clip.height);
        }
    }
    if (right <= left || bottom <= top) return null;
    return { x: left, y: top, width: right - left, height: bottom - top };
}
