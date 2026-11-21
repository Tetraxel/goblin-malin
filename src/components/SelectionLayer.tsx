import { useLayoutEffect, useSyncExternalStore } from "react";
import { screenSelection } from "#base/selection/screenSelection";

/**
 * Makes the screen repaint when the selection changes. The highlight itself is painted by Ink's output stage; this
 * only gives it a React commit to run in (nothing else changes when the pointer moves over text). It draws nothing.
 */
export function SelectionLayer(): null {
    const version = useSyncExternalStore(screenSelection.subscribe, screenSelection.getVersion);
    // React skips the commit phases of a render that changes no host node and runs no effect, and Ink only paints
    // from there (`resetAfterCommit`): without an effect that follows the version, a new highlight is never drawn
    // until something else on the screen changes. The effect itself has nothing to do.
    useLayoutEffect(() => {}, [version]);
    return null;
}
