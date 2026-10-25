import type { Key } from "ink";
import { Shortcut, matchesShortcut } from "#types/actions";

/** Max gap between the two presses of a `doubleTap` shortcut. */
export const DOUBLE_TAP_MS = 500;

export type LastPress = { input: string; key: Key; time: number };

/**
 * Whether the press before the current one was the same key as `shortcut`, recent
 * enough to make the current press its second tap. The current press itself is
 * checked separately with `matchesShortcut`.
 */
export function isDoubleTap(shortcut: Shortcut, previous: LastPress | null, now: number): boolean {
    if (!previous || now - previous.time > DOUBLE_TAP_MS) return false;
    return matchesShortcut(shortcut, previous.input, previous.key);
}
