import { useEffect, useRef, type RefObject } from "react";
import type { DOMElement } from "ink";
import { isClickableWindow } from "#base/mouse/clickableWindows";
import { mouseRegistry } from "#base/mouse/mouse";
import { getScreenBounds } from "#base/mouse/screenBounds";
import { useFocusActions, useFocusChrome } from "#contexts/FocusContext";
import { useToolbarActionsRef } from "#contexts/ToolbarActionsContext";

/**
 * Makes one toolbar button clickable: a left click focuses the toolbar on that button
 * and activates it, as if it had been arrowed to and Enter pressed.
 */
export function useToolbarButtonMouse(ref: RefObject<DOMElement | null>, index: number): void {
    const { activeWindow } = useFocusChrome();
    const { selectToolbarButton } = useFocusActions();
    const actionsRef = useToolbarActionsRef();

    // The subscription below is registered once; it reads the latest window from here.
    const activeWindowRef = useRef(activeWindow);
    useEffect(() => {
        activeWindowRef.current = activeWindow;
    });

    useEffect(() => {
        return mouseRegistry.subscribe((event) => {
            if (event.type !== "press" || event.button !== "left") return;
            if (!isClickableWindow(activeWindowRef.current)) return;
            const bounds = getScreenBounds(ref.current);
            if (!bounds) return;
            const isInside =
                event.x >= bounds.x &&
                event.x < bounds.x + bounds.width &&
                event.y >= bounds.y &&
                event.y < bounds.y + bounds.height;
            if (!isInside) return;
            selectToolbarButton(index);
            actionsRef.current[index]?.();
        });
    }, [ref, index, selectToolbarButton, actionsRef]);
}
