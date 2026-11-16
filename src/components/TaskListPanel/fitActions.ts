/**
 * What of a row of action hints fits in `available` columns. A row that is wider than the panel used to be cut in the
 * middle of a hint, and the keys after the cut were advertised nowhere.
 *
 * Hints are shown in full while there is room; the rest are reduced to their key (`[T]`), which is still a key the
 * user can press and look up; if even that does not fit, the row ends with `…` to say that more exist.
 */

export type HintSize = { label: string; literal: string };
export type FittedHint = { index: number; compact: boolean };
export type FittedRow = { hints: FittedHint[]; more: boolean };

/** Space between two hints (see `Hint`). */
const GAP = 2;
/** The `…` that ends a row that was cut, with the gap before it. */
const MORE_WIDTH = 1 + 1;

const width = (text: string): number => [...text].length;

/** Columns a hint takes: `[key] label`, or just `[key]` when compact, and the gap after it. */
export function hintWidth({ label, literal }: HintSize, compact: boolean): number {
    const key = width(literal) + 2;
    return (compact ? key : key + 1 + width(label)) + GAP;
}

export function fitActions(hints: readonly HintSize[], available: number): FittedRow {
    const full = hints.reduce((sum, h) => sum + hintWidth(h, false), 0);
    if (full <= available) return { hints: hints.map((_, index) => ({ index, compact: false })), more: false };

    // Everything that fits in full, from the left; the others go compact, as many as fit, and "…" when some do not.
    // The compact keys come last, so the room they need is kept back from the full ones.
    const compactWidth = (from: number) => hints.slice(from).reduce((sum, h) => sum + hintWidth(h, true), 0);
    let fullCount = 0;
    let used = 0;
    while (fullCount < hints.length) {
        const next = used + hintWidth(hints[fullCount], false);
        if (next + compactWidth(fullCount + 1) > available) break;
        used = next;
        fullCount++;
    }

    const shown: FittedHint[] = hints.slice(0, fullCount).map((_, index) => ({ index, compact: false }));
    let more = false;
    for (let i = fullCount; i < hints.length; i++) {
        const w = hintWidth(hints[i], true);
        // Keep room for the "…" unless this is the last key and it fits without it.
        const reserve = i < hints.length - 1 ? MORE_WIDTH : 0;
        if (used + w + reserve > available) {
            more = true;
            break;
        }
        used += w;
        shown.push({ index: i, compact: true });
    }
    return { hints: shown, more };
}
