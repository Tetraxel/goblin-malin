import { useEffect, useState } from "react";

/**
 * Returns a debounced copy of `value` that only updates after `delayMs` of
 * quiescence. While `value` changes rapidly (e.g. holding ArrowDown to scroll
 * the task list) the debounced value stays frozen, letting expensive consumers
 * skip re-rendering until the user settles.
 *
 * Trailing-edge: each change reschedules the timer for the latest value.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
    const [debounced, setDebounced] = useState(value);

    useEffect(() => {
        if (Object.is(debounced, value)) return;
        const id = setTimeout(() => setDebounced(value), delayMs);
        return () => clearTimeout(id);
    }, [value, delayMs, debounced]);

    return debounced;
}
