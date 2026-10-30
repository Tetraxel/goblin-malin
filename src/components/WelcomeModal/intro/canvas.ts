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

    toRows(): string[] {
        const out: string[] = [];
        for (let cy = 0; cy < this.rows; cy++) out.push(this.renderSpan(cy, 0, this.cols));
        return out;
    }

    /** Each row as runs of opaque cells, skipping holes. */
    toSegments(): Segment[][] {
        const out: Segment[][] = [];
        for (let cy = 0; cy < this.rows; cy++) {
            const row: Segment[] = [];
            let cx = 0;
            while (cx < this.cols) {
                while (cx < this.cols && this.hole?.[cy * this.cols + cx]) cx++;
                const start = cx;
                while (cx < this.cols && !this.hole?.[cy * this.cols + cx]) cx++;
                if (cx > start) row.push({ x: start, width: cx - start, text: this.renderSpan(cy, start, cx) });
            }
            out.push(row);
        }
        return out;
    }

    /** ANSI truecolor string for cells [x0, x1) of row `cy`. */
    private renderSpan(cy: number, x0: number, x1: number): string {
        let line = "";
        let curFg = -2;
        let curBg = -2;
        let curBold = 0;
        for (let cx = x0; cx < x1; cx++) {
            const top = this.px[cy * 2 * this.pw + cx];
            const bot = this.px[(cy * 2 + 1) * this.pw + cx];
            const g = this.glyph[cy * this.cols + cx];

            let ch: string;
            let fg: number;
            let bg: number;
            const bold = g ? this.glyphBold[cy * this.cols + cx] : 0;
            if (g) {
                ch = g;
                fg = this.glyphFg[cy * this.cols + cx];
                bg = top !== EMPTY ? top : bot !== EMPTY ? bot : this.bg;
            } else if (top === EMPTY && bot === EMPTY) {
                ch = " ";
                fg = curFg; // irrelevant for a space — don't force a colour change
                bg = this.bg;
            } else {
                ch = "▀";
                fg = top === EMPTY ? this.bg : top;
                bg = bot === EMPTY ? this.bg : bot;
            }

            if (bold !== curBold) {
                line += bold ? "\x1b[1m" : "\x1b[22m";
                curBold = bold;
            }
            if (fg !== curFg && fg >= 0) {
                line += `\x1b[38;2;${(fg >> 16) & 0xff};${(fg >> 8) & 0xff};${fg & 0xff}m`;
                curFg = fg;
            }
            if (bg !== curBg) {
                line += `\x1b[48;2;${(bg >> 16) & 0xff};${(bg >> 8) & 0xff};${bg & 0xff}m`;
                curBg = bg;
            }
            line += ch;
        }
        return line + "\x1b[0m";
    }
}
