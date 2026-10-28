import type { FocusableWindow } from "#hooks/useFocusManager";

/** Windows whose on-screen widgets react to clicks. Modals and prompts own the keyboard, so they own input. */
const CLICKABLE_WINDOWS = new Set<FocusableWindow>(["toolbar", "taskList", "secondaryPanel"]);

export function isClickableWindow(window: FocusableWindow): boolean {
    return CLICKABLE_WINDOWS.has(window);
}

/**
 * The focused window, mirrored out of React state so that many small clickable widgets
 * (list rows) can gate on it without each subscribing to the focus context — which would
 * re-render every row whenever focus moves between windows.
 */
let activeWindow: FocusableWindow = "toolbar";

export function setMouseActiveWindow(window: FocusableWindow): void {
    activeWindow = window;
}

export function isMouseInputActive(): boolean {
    return isClickableWindow(activeWindow);
}
