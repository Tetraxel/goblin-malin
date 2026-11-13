import { useEffect, useState } from "react";

export interface DebouncedValueOptions {
    /**
     * Show a change at once when the previous change is more than `delayMs` old (an isolated change, e.g. a single
     * press of ArrowDown), and keep the trailing behaviour while changes keep coming faster than that (a held key).
     * Off by default.
     */
    leading?: boolean;
}

interface State<T> {
    /** The value handed out. */
    shown: T;
    /** The last `value` this hook saw, to notice a change during render. */
    seen: T;
    /** When `seen` last changed (`Date.now()`), 0 before the first change. */
    changedAt: number;
}

/**
 * Returns a debounced copy of `value` that only updates after `delayMs` of
 * quiescence. While `value` changes rapidly (e.g. holding ArrowDown to scroll
 * the task list) the debounced value stays frozen, letting expensive consumers
 * skip re-rendering until the user settles.
 *
 * Trailing-edge: each change reschedules the timer for the latest value.
 *
 * With `{ leading: true }` an isolated change is published in the same commit as the change itself, instead of
 * `delayMs` later: the consumer then costs one frame per isolated change, not two, and nothing lags behind the
 * key. A change that follows another by less than `delayMs` still waits for the trailing timer. The time of the
 * previous change is kept in state and compared during render (the "adjust state while rendering" pattern, no
 * extra timer).
 */
export function useDebouncedValue<T>(value: T, delayMs: number, { leading = false }: DebouncedValueOptions = {}): T {
    const [state, setState] = useState<State<T>>({ shown: value, seen: value, changedAt: 0 });

    let current = state;
    if (leading && !Object.is(state.seen, value)) {
        // eslint-disable-next-line react-hooks/purity -- the clock is the point: "was the previous change recent?"
        const now = Date.now();
        current = {
            shown: now - state.changedAt > delayMs ? value : state.shown,
            seen: value,
            changedAt: now,
        };
        setState(current);
    }
    const { shown } = current;

    useEffect(() => {
        if (Object.is(shown, value)) return;
        const id = setTimeout(() => setState((s) => ({ ...s, shown: value })), delayMs);
        return () => clearTimeout(id);
    }, [value, delayMs, shown]);

    return shown;
}
