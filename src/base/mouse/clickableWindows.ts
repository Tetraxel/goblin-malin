import type { FocusableWindow } from "#hooks/useFocusManager";

/** Windows whose on-screen widgets react to clicks. Modals and prompts own the keyboard, so they own input. */
const CLICKABLE_WINDOWS = new Set<FocusableWindow>(["toolbar", "taskList", "secondaryPanel"]);

export function isClickableWindow(window: FocusableWindow): boolean {
    return CLICKABLE_WINDOWS.has(window);
}
