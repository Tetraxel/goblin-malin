import type { FocusableWindow } from "#hooks/useFocusManager";

/** Windows whose on-screen widgets react to clicks. Modals and prompts own the keyboard, so they own input. */
const CLICKABLE_WINDOWS = new Set<FocusableWindow>(["toolbar", "taskList", "secondaryPanel"]);

export function isClickableWindow(window: FocusableWindow): boolean {
    return CLICKABLE_WINDOWS.has(window);
}

/**
 * The focused window, mirrored out of React state so that many small clickable widgets
 * (list rows) can gate on it without each subscribing to the focus context â€” which would
 * re-render every row whenever focus moves between windows.
 */
let activeWindow: FocusableWindow = "toolbar";

export function setMouseActiveWindow(window: FocusableWindow): void {
    activeWindow = window;
}

export function isMouseInputActive(): boolean {
    return isClickableWindow(activeWindow);
}

/**
 * Whether a mouse target may react right now. Targets on the main screen (toolbar, task list,
 * secondary panel) pass no `window` and follow the clickable-window set. A modal's targets pass
 * the modal's own window, so they react only while that modal is the focused one — never while a
 * confirm dialog sits on top of it, and never to the app underneath.
 */
export function isMouseTargetActive(window?: FocusableWindow): boolean {
    return window ? activeWindow === window : isMouseInputActive();
}
