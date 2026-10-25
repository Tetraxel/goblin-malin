import type { DOMElement } from "ink";

/**
 * Absolute screen position of an Ink element. Yoga reports each node's offset
 * relative to its parent, so walk up and sum. Only meaningful after layout —
 * call it from event handlers/effects, not during render.
 */
export function getScreenBounds(node: DOMElement | null): { x: number; y: number; width: number; height: number } | null {
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
