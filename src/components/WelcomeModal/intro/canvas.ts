// A tiny framebuffer for terminal motion design. Two layers:
//  - pixels: half-block pixels (each cell holds a top + bottom pixel, drawn with "▀"),
//    so the pixel grid is `cols` wide and `rows * 2` tall with roughly square pixels.
//  - glyphs: one character per cell, drawn over the pixels (particles, scramble text…).
// `toRows()` flattens both into one ANSI truecolor string per terminal row.

export type RGB = readonly [number, number, number];

const EMPTY = -1;

export const pack = (c: RGB): number => (clamp255(c[0]) << 16) | (clamp255(c[1]) << 8) | clamp255(c[2]);

const unpack = (p: number): RGB => [(p >> 16) & 0xff, (p >> 8) & 0xff, p & 0xff];

function clamp255(v: number): number {
    return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

export function mix(a: RGB, b: RGB, t: number): RGB {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function scale(c: RGB, k: number): RGB {
    return [c[0] * k, c[1] * k, c[2] * k];
}

export function hex(h: string): RGB {
    const n = parseInt(h.replace("#", ""), 16);
    return unpack(n);
}

/** h in [0,1), s/v in [0,1]. */
export function hsv(h: number, s: number, v: number): RGB {
    h = ((h % 1) + 1) % 1;
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const u = v * (1 - (1 - f) * s);
    const [r, g, b] = [
        [v, u, p],
        [q, v, p],
        [p, v, u],
        [p, q, v],
        [u, p, v],
        [v, p, q],
    ][i % 6];
    return [r * 255, g * 255, b * 255];
}

/** Every cell of a canvas, resolved to what the terminal shows. */
export interface Frame {
    cols: number;
    rows: number;
    ch: string[];
    fg: Int32Array;
    bg: Int32Array;
    bold: Uint8Array;
}

// The colours and weight the terminal is currently set to while emitting ANSI.
interface Pen {
    fg: number;
    bg: number;
    bold: number;
}

const newPen = (): Pen => ({ fg: -2, bg: -2, bold: 0 });

const RESET = "\x1b[0m";
const NO_FG = -1;
// Unchanged cells a diff run may swallow rather than moving the cursor.
const MAX_RUN_GAP = 4;

// Rounds each channel to 32 levels (keeping pure white): slow colour drifts then change a
// cell's colour only every few frames, and neighbours share colours, so far fewer bytes
// reach the terminal. The steps are invisible at half-block resolution.
const LEVEL = Uint8Array.from({ length: 256 }, (_, v) => (v >= 248 ? 255 : v & 0xf8));
const quantize = (p: number): number =>
    (LEVEL[(p >> 16) & 0xff] << 16) | (LEVEL[(p >> 8) & 0xff] << 8) | LEVEL[p & 0xff];

/** A run of opaque cells in one row, starting at column `x`, `width` cells wide. */
export interface Segment {
    x: number;
    width: number;
    text: string;
}

export class Canvas {
    readonly cols: number;
    readonly rows: number;
    /** Pixel grid size: `pw` = cols, `ph` = rows * 2. */
    readonly pw: number;
    readonly ph: number;

    private readonly px: Int32Array;
    // Depth of each solid pixel (-1 = none). Solid pixels hide "behind" glyphs (dust
    // behind the face); soft glows don't. Lets layers be drawn in any order.
    private readonly depth: Int8Array;
    private readonly glyph: string[];
    private readonly glyphFg: Int32Array;
    private readonly glyphBold: Uint8Array;
    // Horizontal clip window, in cells (= pixel columns). Used for wipe transitions.
    private clipX0 = 0;
    private clipX1 = Infinity;

    // Packed colour shown where nothing is drawn.
    private readonly bg: number;
    // Cells left unwritten so whatever is underneath (the app) shows through; null = none.
    private hole: Uint8Array | null = null;

    constructor(cols: number, rows: number, background: RGB = [0, 0, 0]) {
        this.bg = pack(background);
        this.cols = cols;
        this.rows = rows;
        this.pw = cols;
        this.ph = rows * 2;
        this.px = new Int32Array(this.pw * this.ph).fill(EMPTY);
        this.depth = new Int8Array(this.pw * this.ph).fill(-1);
        this.glyph = new Array<string>(cols * rows).fill("");
        this.glyphFg = new Int32Array(cols * rows);
        this.glyphBold = new Uint8Array(cols * rows);
    }

    /** Restricts all drawing to columns [x0, x1) until `resetClip()`. */
    setClip(x0: number, x1: number): void {
        this.clipX0 = x0;
        this.clipX1 = x1;
    }

    resetClip(): void {
        this.clipX0 = 0;
        this.clipX1 = Infinity;
    }

    private clipped(x: number): boolean {
        return x < this.clipX0 || x >= this.clipX1;
    }

    /** Writes a solid pixel unless something at a greater depth `z` is already there. */
    setPixel(x: number, y: number, c: RGB, z = 0): void {
        x = Math.floor(x);
        y = Math.floor(y);
        if (x < 0 || y < 0 || x >= this.pw || y >= this.ph || this.clipped(x)) return;
        const i = y * this.pw + x;
        if (z < this.depth[i]) return;
        this.px[i] = pack(c);
        this.depth[i] = z;
        if (this.hole) this.hole[(y >> 1) * this.cols + x] = 0;
    }

    /** Alpha-blends a colour onto whatever is there (black if empty). Not opaque. */
    blendPixel(x: number, y: number, c: RGB, alpha: number): void {
        x = Math.floor(x);
        y = Math.floor(y);
        if (x < 0 || y < 0 || x >= this.pw || y >= this.ph || alpha <= 0 || this.clipped(x)) return;
        // Soft glows don't refill holes: they'd paint squares over what shows through.
        if (this.hole?.[(y >> 1) * this.cols + x]) return;
        const i = y * this.pw + x;
        const under = this.px[i] === EMPTY ? unpack(this.bg) : unpack(this.px[i]);
        this.px[i] = pack(mix(under, c, Math.min(1, alpha)));
    }

    /**
     * Places a character in a cell. With `behind`, it is skipped when a solid pixel or
     * another glyph already covers the cell — so background particles disappear behind
     * solid shapes and never eat into text.
     */
    setGlyph(cx: number, cy: number, ch: string, c: RGB, behind = false, bold = false): void {
        cx = Math.floor(cx);
        cy = Math.floor(cy);
        if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows || this.clipped(cx)) return;
        const i = cy * this.cols + cx;
        if (behind) {
            const top = cy * 2 * this.pw + cx;
            if (this.glyph[i] || this.depth[top] >= 0 || this.depth[top + this.pw] >= 0) return;
        }
        this.glyph[i] = ch;
        this.glyphFg[i] = pack(c);
        this.glyphBold[i] = bold ? 1 : 0;
        if (this.hole) this.hole[i] = 0;
    }

    /**
     * Makes the cells where `inHole(cx, cy)` holds transparent: they're left out of
     * `toSegments()`, so the app underneath shows through. Anything drawn afterwards
     * (solid pixels, glyphs) fills its cells again.
     */
    punchHole(inHole: (cx: number, cy: number) => boolean): void {
        this.hole = new Uint8Array(this.cols * this.rows);
        for (let cy = 0; cy < this.rows; cy++) {
            for (let cx = 0; cx < this.cols; cx++) {
                if (inHole(cx, cy)) this.hole[cy * this.cols + cx] = 1;
            }
        }
    }

    /** Fades everything drawn so far towards the background, by `k` (0..1). */
    fadeToBackground(k: number): void {
        if (k <= 0) return;
        const bg = unpack(this.bg);
        const f = (p: number) => pack(mix(unpack(p), bg, Math.min(1, k)));
        for (let i = 0; i < this.px.length; i++) if (this.px[i] !== EMPTY) this.px[i] = f(this.px[i]);
        for (let i = 0; i < this.glyph.length; i++) if (this.glyph[i]) this.glyphFg[i] = f(this.glyphFg[i]);
    }

    /** Flattens both layers into one resolved cell per terminal position. */
    private snapshot(): Frame {
        const n = this.cols * this.rows;
        const frame: Frame = {
            cols: this.cols,
            rows: this.rows,
            ch: new Array<string>(n),
            fg: new Int32Array(n),
            bg: new Int32Array(n),
            bold: new Uint8Array(n),
        };
        const canvasBg = quantize(this.bg);
        for (let cy = 0; cy < this.rows; cy++) {
            for (let cx = 0; cx < this.cols; cx++) {
                const i = cy * this.cols + cx;
                const top = this.px[cy * 2 * this.pw + cx];
                const bot = this.px[(cy * 2 + 1) * this.pw + cx];
                const g = this.glyph[i];
                if (g) {
                    frame.ch[i] = g;
                    frame.fg[i] = quantize(this.glyphFg[i]);
                    frame.bg[i] = top !== EMPTY ? quantize(top) : bot !== EMPTY ? quantize(bot) : canvasBg;
                    frame.bold[i] = this.glyphBold[i];
                } else if (top === EMPTY && bot === EMPTY) {
                    frame.ch[i] = " ";
                    frame.fg[i] = NO_FG; // a space has no ink: never force a colour change for it
                    frame.bg[i] = canvasBg;
                } else {
                    frame.ch[i] = "▀";
                    frame.fg[i] = top === EMPTY ? canvasBg : quantize(top);
                    frame.bg[i] = bot === EMPTY ? canvasBg : quantize(bot);
                }
            }
        }
        return frame;
    }

    toRows(): string[] {
        const frame = this.snapshot();
        const out: string[] = [];
        for (let cy = 0; cy < this.rows; cy++) out.push(renderSpan(frame, cy, 0, this.cols, newPen()) + RESET);
        return out;
    }

    /** Each row as runs of opaque cells, skipping holes. */
    toSegments(): Segment[][] {
        const frame = this.snapshot();
        const out: Segment[][] = [];
        for (let cy = 0; cy < this.rows; cy++) {
            const row: Segment[] = [];
            let cx = 0;
            while (cx < this.cols) {
                while (cx < this.cols && this.hole?.[cy * this.cols + cx]) cx++;
                const start = cx;
                while (cx < this.cols && !this.hole?.[cy * this.cols + cx]) cx++;
                if (cx > start) {
                    const text = renderSpan(frame, cy, start, cx, newPen()) + RESET;
                    row.push({ x: start, width: cx - start, text });
                }
            }
            out.push(row);
        }
        return out;
    }

    /**
     * The ANSI that turns `previous` into this canvas: only the cells that changed, each
     * run positioned absolutely. A null or differently-sized `previous` repaints it all.
     * Returns "" when nothing changed.
     */
    diffFrom(previous: Frame | null): { ansi: string; frame: Frame } {
        const frame = this.snapshot();
        const prev = previous && previous.cols === frame.cols && previous.rows === frame.rows ? previous : null;
        const same = (i: number) =>
            prev !== null &&
            prev.ch[i] === frame.ch[i] &&
            prev.bg[i] === frame.bg[i] &&
            prev.bold[i] === frame.bold[i] &&
            prev.fg[i] === frame.fg[i];

        const pen = newPen();
        let ansi = "";
        for (let cy = 0; cy < this.rows; cy++) {
            const base = cy * this.cols;
            let cx = 0;
            while (cx < this.cols) {
                while (cx < this.cols && same(base + cx)) cx++;
                if (cx >= this.cols) break;
                const start = cx;
                // Runs swallow short unchanged gaps: re-sending a few cells is cheaper
                // than a cursor move and a new colour.
                let end = cx + 1;
                let gap = 0;
                for (cx = end; cx < this.cols && gap <= MAX_RUN_GAP; cx++) {
                    if (same(base + cx)) gap++;
                    else {
                        gap = 0;
                        end = cx + 1;
                    }
                }
                cx = end;
                ansi += `\x1b[${cy + 1};${start + 1}H` + renderSpan(frame, cy, start, end, pen);
            }
        }
        return { ansi: ansi && ansi + RESET, frame };
    }
}

/** ANSI truecolor string for cells [x0, x1) of row `cy`, starting from the `pen` state. */
function renderSpan(frame: Frame, cy: number, x0: number, x1: number, pen: Pen): string {
    let line = "";
    for (let cx = x0; cx < x1; cx++) {
        const i = cy * frame.cols + cx;
        const fg = frame.fg[i];
        const bg = frame.bg[i];
        const bold = frame.bold[i];
        if (bold !== pen.bold) {
            line += bold ? "\x1b[1m" : "\x1b[22m";
            pen.bold = bold;
        }
        if (fg !== pen.fg && fg !== NO_FG) {
            line += `\x1b[38;2;${(fg >> 16) & 0xff};${(fg >> 8) & 0xff};${fg & 0xff}m`;
            pen.fg = fg;
        }
        if (bg !== pen.bg) {
            line += `\x1b[48;2;${(bg >> 16) & 0xff};${(bg >> 8) & 0xff};${bg & 0xff}m`;
            pen.bg = bg;
        }
        line += frame.ch[i];
    }
    return line;
}
