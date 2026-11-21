/**
 * What is on the screen, read back from Ink.
 *
 * The patched Ink output stage (`patches/ink/output.js`, change [5]) keeps the cells of the frame it painted last and
 * lets the app restyle some rows before they are written (the selection highlight). The two sides share one object
 * through `globalThis`, under a registered symbol: this file cannot import Ink's internals, and the patch cannot
 * import the app. With the stock Ink (the patch not applied) `frame` stays empty and nothing can be selected.
 */

/** One of the ANSI style codes a cell carries (`@alcalzone/ansi-tokenize`). */
export type AnsiStyle = { type: "ansi"; code: string; endCode: string };

/**
 * One cell of the screen. A wide character (CJK, emoji) is a cell with the glyph followed by a cell whose value is
 * `""`. Cells are shared between frames: never edit one, make a copy.
 */
export type ScreenCell = { type: "char"; value: string; fullWidth: boolean; styles: readonly AnsiStyle[] };

/** A screen row. Cells Ink never wrote can be missing (`undefined`). */
export type ScreenRow = readonly (ScreenCell | undefined)[];

/** Returns the row `y` restyled, or `undefined` to leave it as it is. */
export type RowHighlighter = (y: number, row: ScreenRow) => readonly ScreenCell[] | undefined;

export type ScreenTap = {
    /** The rows of the last frame Ink painted, before any highlight. Read-only. */
    frame: readonly ScreenRow[];
    /** Called by Ink for every row of every frame while set. */
    highlight: RowHighlighter | undefined;
};

const KEY = Symbol.for("goblin-malin.screenTap");

export function getScreenTap(): ScreenTap {
    const holder = globalThis as unknown as Record<symbol, ScreenTap | undefined>;
    return (holder[KEY] ??= { frame: [], highlight: undefined });
}
