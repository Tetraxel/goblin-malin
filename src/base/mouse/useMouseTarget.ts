import { useEffect, useRef, useState, type RefObject } from "react";
import type { DOMElement } from "ink";
import { isMouseInputActive } from "./clickableWindows";
import { mouseRegistry, type MouseEvent } from "./mouse";
import { getVisibleScreenBounds } from "./screenBounds";

function isInside(event: MouseEvent, node: DOMElement | null): boolean {
    const bounds = getVisibleScreenBounds(node);
    if (!bounds) return false;
    return (
        event.x >= bounds.x && event.x < bounds.x + bounds.width && event.y >= bounds.y && event.y < bounds.y + bounds.height
    );
}

/**
 * Calls `onClick` when the element is left-clicked. The latest `onClick` is always used,
 * so callers can pass an inline closure without resubscribing.
 */
export function useClickTarget(ref: RefObject<DOMElement | null>, onClick: (event: MouseEvent) => void): void {
    const latest = useRef(onClick);
    useEffect(() => {
        latest.current = onClick;
    });

    useEffect(() => {
        return mouseRegistry.subscribe((event) => {
            if (event.type !== "press" || event.button !== "left") return;
            if (!isMouseInputActive() || !isInside(event, ref.current)) return;
            latest.current(event);
        });
    }, [ref]);
}

/**
 * Whether the pointer is over the element. Re-renders only the calling component, and only
 * when the answer changes. Wheeling doesn't re-evaluate it, so it can lag until the next move.
 */
export function useHoverTarget(ref: RefObject<DOMElement | null>): boolean {
    const [hovered, setHovered] = useState(false);

    useEffect(() => {
        return mouseRegistry.subscribe((event) => {
            if (event.type !== "move") return;
            setHovered(isMouseInputActive() && isInside(event, ref.current));
        });
    }, [ref]);

    return hovered;
}

/**
 * Calls `onScroll(±1)` for each wheel notch over the element (+1 = down). Like the task
 * list, wheeling never moves keyboard focus.
 */
export function useWheelTarget(ref: RefObject<DOMElement | null>, onScroll: (delta: number) => void): void {
    const latest = useRef(onScroll);
    useEffect(() => {
        latest.current = onScroll;
    });

    useEffect(() => {
        return mouseRegistry.subscribe((event) => {
            if (event.button !== "wheelUp" && event.button !== "wheelDown") return;
            if (!isMouseInputActive() || !isInside(event, ref.current)) return;
            latest.current(event.button === "wheelDown" ? 1 : -1);
        });
    }, [ref]);
}
