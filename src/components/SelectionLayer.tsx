import { useSyncExternalStore } from "react";
import { screenSelection } from "#base/selection/screenSelection";

/**
 * Makes the screen repaint when the selection changes. The highlight itself is painted by Ink's output stage; this
 * only gives it a React commit to run in (nothing else changes when the pointer moves over text). It draws nothing.
 */
export function SelectionLayer(): null {
    useSyncExternalStore(screenSelection.subscribe, screenSelection.getVersion);
    return null;
}
