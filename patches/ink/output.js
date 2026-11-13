// Goblin Malin's patched copy of `ink/build/output.js` (Ink 8.0.0).
//
// Why: stock Ink creates a new `Output` and a new `OutputCaches` for every frame, so nothing survives from one
// frame to the next. Every frame therefore tokenises every character of the screen up to three times and
// stringifies every row, whatever changed: ~46 ms at 200x60. See AUDIT-performance-2.md (PERF2-01).
//
// What differs from the stock file (the output is byte-for-byte identical; the numbered markers say where):
//   [1] one `OutputCaches` shared by all frames (a two-generation cache with a size budget, below);
//   [2] the split lines of a write are cached by its text, and clipped slices by (line, from, to);
//   [3] blank cells share one frozen object, and a row whose cells are all the same objects as in the previous
//       frame reuses that frame's string;
//   [4] `widestLine`, exported for the patched render-node-to-output.js, measures through the same cache.
//
// It is installed over `node_modules/ink/build/output.js` by `scripts/apply-ink-patch.mjs` (which checks that
// the file it replaces is the stock one), and bundled into `dist` by tsup. Its sibling render-node-to-output.js
// is patched for [4] only.
import stringWidth from 'string-width';
import { styledCharsFromTokens, styledCharsToString, tokenize, } from '@alcalzone/ansi-tokenize';
// Replaces a partially visible wide character with a space that keeps its styles.
const blankCell = (cell) => ({
    ...cell,
    value: ' ',
    fullWidth: false,
});
// [3] Every empty cell of every frame is this one object, so "the row did not change" is an identity check.
// Cells are never edited in place (writes replace them, `blankCell` copies), so sharing and freezing are safe.
const BLANK_CELL = Object.freeze({
    type: 'char',
    value: ' ',
    fullWidth: false,
    styles: Object.freeze([]),
});
// [3] The placeholder cell after a wide character, one object per character object (which the cache keeps stable),
// so a row with CJK text can also be recognised as unchanged.
const continuationCells = new WeakMap();
const continuationCell = (character) => {
    let cell = continuationCells.get(character);
    if (cell === undefined) {
        cell = { type: 'char', value: '', fullWidth: false, styles: character.styles };
        continuationCells.set(character, cell);
    }
    return cell;
};
// An undefined bound means "unbounded on this edge", so intersecting keeps whichever bound is defined and takes the tighter one when both are.
const intersectBound = (a, b, tighter) => {
    if (a === undefined) {
        return b;
    }
    return b === undefined ? a : tighter(a, b);
};
// Bounds are half-open: `x2`/`y2` are exclusive, so an axis is empty as soon as its lower bound reaches its upper one.
const isClipEmpty = (clip) => (clip.x1 !== undefined && clip.x2 !== undefined && clip.x1 >= clip.x2) ||
    (clip.y1 !== undefined && clip.y2 !== undefined && clip.y1 >= clip.y2);
const intersectClips = (outer, inner) => {
    if (!outer) {
        return inner;
    }
    return {
        x1: intersectBound(outer.x1, inner.x1, Math.max),
        x2: intersectBound(outer.x2, inner.x2, Math.min),
        y1: intersectBound(outer.y1, inner.y1, Math.max),
        y2: intersectBound(outer.y2, inner.y2, Math.min),
    };
};
// [1] A cache that survives between frames without growing for ever: two generations. A lookup that misses in
// the current one but hits in the previous one promotes the entry; when the current one is over its budget it
// becomes the previous one and a new one starts. What the last frames used stays; the rest is dropped within two
// rotations. The budget is in approximate bytes: each caller says what an entry weighs (the key, and what the value
// holds: a styled character is an object of ~100 bytes, not the 2 bytes of the character it stands for).
class GenerationalCache {
    budget;
    current = new Map();
    previous = new Map();
    used = 0;
    constructor(budget) {
        this.budget = budget;
    }
    get(key) {
        const hit = this.current.get(key);
        if (hit !== undefined) {
            return hit;
        }
        const old = this.previous.get(key);
        if (old !== undefined) {
            // Promoted without its value's weight (not kept): what was promoted came out of a generation that was
            // already within budget, so the total stays under three budgets.
            this.set(key, old, 0);
        }
        return old;
    }
    set(key, value, weight) {
        this.current.set(key, value);
        this.charge(typeof key === 'string' ? key.length * 2 + 48 + weight : 48 + weight);
    }
    // Accounts for memory an entry gained after it was stored (the inner map of a slices entry grows).
    charge(weight) {
        this.used += weight;
        if (this.used > this.budget) {
            this.previous = this.current;
            this.current = new Map();
            this.used = 0;
        }
    }
}
// Approximate bytes of one styled character object (value, styles, flags) and of one cached string character.
const STYLED_CHAR_BYTES = 100;
const STRING_CHAR_BYTES = 2;
const MB = 1024 * 1024;
class OutputCaches {
    widths = new GenerationalCache(4 * MB);
    blockWidths = new GenerationalCache(2 * MB);
    styledChars = new GenerationalCache(40 * MB);
    // [2] text -> its lines as strings (after splitting on '\n', styles kept across the split).
    lines = new GenerationalCache(8 * MB);
    // [2] line -> Map(`${from}:${to}` -> the line clipped to those columns).
    slices = new GenerationalCache(8 * MB);
    getStyledChars(line) {
        let cached = this.styledChars.get(line);
        if (cached === undefined) {
            // Standalone invisible Unicode characters must not occupy terminal cells.
            cached = styledCharsFromTokens(tokenize(line)).filter(character => !/^\p{Default_Ignorable_Code_Point}+$/u.test(character.value));
            this.styledChars.set(line, cached, cached.length * STYLED_CHAR_BYTES);
        }
        return cached;
    }
    getStringWidth(text) {
        let cached = this.widths.get(text);
        if (cached === undefined) {
            cached = stringWidth(text);
            this.widths.set(text, cached, 8);
        }
        return cached;
    }
    getWidestLine(text) {
        let cached = this.blockWidths.get(text);
        if (cached === undefined) {
            let lineWidth = 0;
            for (const line of text.split('\n')) {
                lineWidth = Math.max(lineWidth, this.getStringWidth(line));
            }
            cached = lineWidth;
            this.blockWidths.set(text, cached, 8);
        }
        return cached;
    }
    // [2] Preserve styles across explicit newlines before clipping individual rows. Callers must not edit the result.
    getLines(text) {
        let cached = this.lines.get(text);
        if (cached === undefined) {
            const characterLines = [[]];
            for (const character of this.getStyledChars(text)) {
                if (character.value === '\n') {
                    characterLines.push([]);
                }
                else {
                    characterLines.at(-1).push(character);
                }
            }
            cached = characterLines.map(line => styledCharsToString(line));
            this.lines.set(text, cached, cached.reduce((total, line) => total + line.length * STRING_CHAR_BYTES + 48, 0));
        }
        return cached;
    }
}
const sharedCaches = new OutputCaches();
// For tests: a tiny budget makes the caches rotate on almost every entry, which is how rotation is exercised.
export const setCacheBudgetForTests = (bytes) => {
    for (const cache of [sharedCaches.widths, sharedCaches.blockWidths, sharedCaches.styledChars, sharedCaches.lines, sharedCaches.slices]) {
        cache.budget = bytes;
    }
};
// [4] The width of the widest line of a text, memoised for all frames. Replaces `widest-line` in
// render-node-to-output.js, which ran `string-width` (and its emoji regex) on every text node of every frame.
// Same result: the width of each line by `string-width`, and the maximum.
export const widestLine = (text) => sharedCaches.getWidestLine(text);
// [3] The rows of the previous frame (cells + the string made from them), per output size, so a frame that
// changed two rows stringifies two rows. Correctness never depends on it: a row is reused only when every cell
// is the same object as before.
const previousFrames = new Map();
const getPreviousFrame = (width, height) => {
    const key = `${width}x${height}`;
    let frame = previousFrames.get(key);
    if (frame === undefined) {
        if (previousFrames.size >= 4) {
            previousFrames.clear();
        }
        frame = [];
        previousFrames.set(key, frame);
    }
    return frame;
};
const sameCells = (a, b) => {
    if (a.length !== b.length) {
        return false;
    }
    for (let index = 0; index < a.length; index++) {
        if (a[index] !== b[index]) {
            return false;
        }
    }
    return true;
};
export default class Output {
    operations = [];
    caches = sharedCaches;
    width;
    height;
    constructor(options) {
        const { width, height } = options;
        this.width = width;
        this.height = height;
    }
    applyWriteOperation(output, operation, clip) {
        const { text, transformers } = operation;
        let { x, y } = operation;
        let lines = this.caches.getLines(text);
        if (clip) {
            // Two nested clips can intersect to nothing. Nothing is visible, so bail out before slicing.
            if (isClipEmpty(clip)) {
                return;
            }
            const shouldClipHorizontally = typeof clip?.x1 === 'number' && typeof clip?.x2 === 'number';
            const shouldClipVertically = typeof clip?.y1 === 'number' && typeof clip?.y2 === 'number';
            // If text is positioned outside of clipping area altogether,
            // skip to the next operation to avoid unnecessary calculations
            if (shouldClipHorizontally) {
                const width = this.caches.getWidestLine(text);
                if (x + width < clip.x1 || x > clip.x2) {
                    return;
                }
            }
            if (shouldClipVertically) {
                const height = lines.length;
                if (y + height < clip.y1 || y > clip.y2) {
                    return;
                }
            }
            if (shouldClipHorizontally) {
                lines = lines.map(line => {
                    const from = x < clip.x1 ? clip.x1 - x : 0;
                    const width = this.caches.getStringWidth(line);
                    const to = x + width > clip.x2 ? clip.x2 - x : width;
                    return this.sliceLineToColumns(line, from, to);
                });
                if (x < clip.x1) {
                    x = clip.x1;
                }
            }
            if (shouldClipVertically) {
                const from = y < clip.y1 ? clip.y1 - y : 0;
                const height = lines.length;
                const to = y + height > clip.y2 ? clip.y2 - y : height;
                lines = lines.slice(from, to);
                if (y < clip.y1) {
                    y = clip.y1;
                }
            }
        }
        for (let [index, line] of lines.entries()) {
            const currentLine = output[y + index];
            // Lines above or below the output area have no corresponding pre-initialized row.
            if (!currentLine) {
                continue;
            }
            for (const transformer of transformers) {
                line = transformer(line, index + y - operation.y);
            }
            const characters = this.caches.getStyledChars(line);
            // Nothing to write (e.g. line was clipped away).
            if (characters.length === 0) {
                continue;
            }
            let offsetX = x;
            // Wide characters (e.g. CJK) occupy two cells: a leading
            // cell with the character and a trailing placeholder with
            // value ''. When an overlapping write lands in the middle
            // of a wide character, the boundary cells need cleanup so
            // the terminal never renders a half-visible wide character.
            // Preserve the styles of cells outside the overlapping write.
            if (currentLine[offsetX]?.value === '' &&
                offsetX > 0 &&
                this.caches.getStringWidth(currentLine[offsetX - 1]?.value ?? '') > 1) {
                currentLine[offsetX - 1] = blankCell(currentLine[offsetX - 1]);
            }
            for (const character of characters) {
                currentLine[offsetX] = character;
                // Determine printed width using string-width to align with measurement
                const characterWidth = Math.max(1, this.caches.getStringWidth(character.value));
                // For multi-column characters, clear following cells to avoid stray spaces/artifacts
                if (characterWidth > 1) {
                    for (let offset = 1; offset < characterWidth; offset++) {
                        currentLine[offsetX + offset] =
                            offsetX < 0
                                ? {
                                    type: 'char',
                                    // Preserve visible cells when the leading cell is outside the output.
                                    value: ' ',
                                    fullWidth: false,
                                    styles: character.styles,
                                }
                                : continuationCell(character);
                    }
                }
                offsetX += characterWidth;
            }
            if (currentLine[offsetX]?.value === '') {
                currentLine[offsetX] = blankCell(currentLine[offsetX]);
            }
        }
    }
    write(x, y, text, options) {
        const { transformers } = options;
        if (text === '') {
            return;
        }
        this.operations.push({
            type: 'write',
            x,
            y,
            text,
            transformers,
        });
    }
    clip(clip) {
        this.operations.push({
            type: 'clip',
            clip,
        });
    }
    unclip() {
        this.operations.push({
            type: 'unclip',
        });
    }
    // Clipping works in terminal columns. A wide character (e.g. CJK) occupies two cells, so when a clip edge falls between its halves, the character must be replaced by a space that keeps its styles, otherwise its background disappears and the rest of the line shifts by a column.
    sliceLineToColumns(line, from, to) {
        if (from >= to) {
            return '';
        }
        // [2] Pure in (line, from, to), and the same rows are clipped the same way frame after frame.
        const key = `${from}:${to}`;
        let slicesOfLine = this.caches.slices.get(line);
        const cachedSlice = slicesOfLine?.get(key);
        if (cachedSlice !== undefined) {
            return cachedSlice;
        }
        const result = [];
        let column = 0;
        for (const character of this.caches.getStyledChars(line)) {
            const width = this.caches.getStringWidth(character.value);
            const start = column;
            column += width;
            if (column <= from) {
                continue;
            }
            if (start >= to) {
                break;
            }
            if (width > 1 && (start < from || column > to)) {
                // Only part of this wide character is visible, so keep the cell count and styles, but drop the glyph itself.
                result.push(blankCell(character));
            }
            else {
                result.push(character);
            }
        }
        const sliced = styledCharsToString(result);
        if (slicesOfLine === undefined) {
            slicesOfLine = new Map();
            this.caches.slices.set(line, slicesOfLine, 0);
        }
        slicesOfLine.set(key, sliced);
        // The inner map grows with every distinct (from, to) of a line (a resize clips the same line at many widths).
        this.caches.slices.charge(key.length * STRING_CHAR_BYTES + sliced.length * STRING_CHAR_BYTES + 96);
        return sliced;
    }
    get() {
        // Initialize output array with a specific set of rows, so that margin/padding at the bottom is preserved
        const output = [];
        // Same number of cells as the stock loop `for (x = 0; x < width; x++)`.
        const rowWidth = Number.isFinite(this.width) ? Math.max(0, Math.ceil(this.width)) : 0;
        for (let y = 0; y < this.height; y++) {
            // [3] Shared blank cells (stock Ink allocates `width x height` new objects here).
            output.push(new Array(rowWidth).fill(BLANK_CELL));
        }
        const clips = [];
        for (const operation of this.operations) {
            if (operation.type === 'clip') {
                // Nested clips must intersect, not replace, otherwise an inner `overflow="hidden"` box lets content escape the outer clip and overwrite surrounding UI.
                clips.push(intersectClips(clips.at(-1), operation.clip));
            }
            else if (operation.type === 'unclip') {
                clips.pop();
            }
            else {
                this.applyWriteOperation(output, operation, clips.at(-1));
            }
        }
        const previousFrame = getPreviousFrame(this.width, this.height);
        const generatedOutput = output
            .map((line, y) => {
            // [3] Same cells as the row at this place in the previous frame: same string.
            const previous = previousFrame[y];
            if (previous !== undefined && sameCells(previous.cells, line)) {
                return previous.text;
            }
            // See https://github.com/vadimdemedes/ink/pull/564#issuecomment-1637022742
            const lineWithoutEmptyItems = line.filter(item => item !== undefined);
            const text = styledCharsToString(lineWithoutEmptyItems).trimEnd();
            previousFrame[y] = { cells: line, text };
            return text;
        })
            .join('\n');
        previousFrame.length = output.length;
        return {
            output: generatedOutput,
            height: output.length,
        };
    }
}
