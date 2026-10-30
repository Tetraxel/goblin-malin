import { useEffect, useRef, useState, type RefObject } from "react";
import type { DOMElement } from "ink";
import { isClickableWindow } from "#base/mouse/clickableWindows";
import { mouseRegistry, type MouseEvent } from "#base/mouse/mouse";
import { getScreenBounds } from "#base/mouse/screenBounds";
import { useFocusChrome } from "#contexts/FocusContext";

/**
 * Makes the tabs of a `TabBar` interactive: a left click on a tab's "[n] label" selects it,
 * as if its number key had been pressed, and hovering one highlights it.
 *
 * @returns the key of the hovered tab, if any.
 */
export function useTabBarMouse(
    tabRefs: RefObject<(DOMElement | null)[]>,
    tabKeys: string[],
    onSelect: ((key: string) => void) | undefined
): string | undefined {
    const { activeWindow } = useFocusChrome();
    const [hoveredKey, setHoveredKey] = useState<string | undefined>();

    // The subscription below is registered once; it reads the latest render's values from here.
    const latest = useRef({ activeWindow, tabKeys, onSelect });
    useEffect(() => {
        latest.current = { activeWindow, tabKeys, onSelect };
    });

    useEffect(() => {
        const tabAt = (event: MouseEvent, tabKeys: string[]): string | undefined => {
            for (let i = 0; i < tabKeys.length; i++) {
                const bounds = getScreenBounds(tabRefs.current[i] ?? null);
                if (!bounds) continue;
                const isInside =
                    event.x >= bounds.x &&
                    event.x < bounds.x + bounds.width &&
                    event.y >= bounds.y &&
                    event.y < bounds.y + bounds.height;
                if (isInside) return tabKeys[i];
            }
            return undefined;
        };

        return mouseRegistry.subscribe((event) => {
            const { activeWindow, tabKeys, onSelect } = latest.current;
            const interactive = onSelect !== undefined && isClickableWindow(activeWindow);

            if (event.type === "move") {
                // Bails out of the re-render when the hovered tab is unchanged.
                setHoveredKey(interactive ? tabAt(event, tabKeys) : undefined);
                return;
            }
            if (event.type !== "press" || event.button !== "left" || !interactive) return;

            const key = tabAt(event, tabKeys);
            if (key !== undefined) onSelect(key);
        });
    }, [tabRefs]);

    return hoveredKey;
}
