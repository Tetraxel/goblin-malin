import { useEffect, useRef, type RefObject } from "react";
import type { DOMElement } from "ink";
import { isClickableWindow } from "#base/mouse/clickableWindows";
import { mouseRegistry } from "#base/mouse/mouse";
import { getScreenBounds } from "#base/mouse/screenBounds";
import { useFocusChrome } from "#contexts/FocusContext";

/**
 * Makes the tabs of a `TabBar` clickable: a left click on a tab's "[n] label" selects it,
 * as if its number key had been pressed.
 */
export function useTabBarMouse(
    tabRefs: RefObject<(DOMElement | null)[]>,
    tabKeys: string[],
    onSelect: ((key: string) => void) | undefined
): void {
    const { activeWindow } = useFocusChrome();

    // The subscription below is registered once; it reads the latest render's values from here.
    const latest = useRef({ activeWindow, tabKeys, onSelect });
    useEffect(() => {
        latest.current = { activeWindow, tabKeys, onSelect };
    });

    useEffect(() => {
        return mouseRegistry.subscribe((event) => {
            if (event.type !== "press" || event.button !== "left") return;
            const { activeWindow, tabKeys, onSelect } = latest.current;
            if (!onSelect || !isClickableWindow(activeWindow)) return;

            for (let i = 0; i < tabKeys.length; i++) {
                const bounds = getScreenBounds(tabRefs.current[i] ?? null);
                if (!bounds) continue;
                const isInside =
                    event.x >= bounds.x &&
                    event.x < bounds.x + bounds.width &&
                    event.y >= bounds.y &&
                    event.y < bounds.y + bounds.height;
                if (isInside) {
                    onSelect(tabKeys[i]);
                    return;
                }
            }
        });
    }, [tabRefs]);
}
