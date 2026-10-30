import { Canvas, RGB, hex, mix, scale } from "./canvas";
import { clamp01 } from "./easing";

// Cell-space drawing helpers for the app tour: text, panels, keycaps. Panel fills are
// solid pixels (so text drawn on top picks them up as its background, and background
// dust hides behind them); borders and text are glyphs.

export const UI_Z = 3;

export interface TextStyle {
    bold?: boolean;
    /** Draw spaces too (e.g. a title cutting through a border), instead of leaving them see-through. */
    solid?: boolean;
    /** Clip to this many cells; "…" marks the cut. */
    maxWidth?: number;
}

export function drawText(canvas: Canvas, x: number, y: number, s: string, fg: RGB, style: TextStyle = {}): number {
    let str = s;
    if (style.maxWidth !== undefined && str.length > style.maxWidth) {
        str = style.maxWidth <= 1 ? str.slice(0, Math.max(0, style.maxWidth)) : str.slice(0, style.maxWidth - 1) + "…";
    }
    for (let i = 0; i < str.length; i++) {
        if (str[i] !== " " || style.solid) canvas.setGlyph(x + i, y, str[i], fg, false, style.bold);
    }
    return str.length;
}

/** Fills whole cells with a solid colour (both half-pixels). */
export function fillCells(canvas: Canvas, x: number, y: number, w: number, h: number, c: RGB, z = UI_Z): void {
    for (let cy = Math.floor(y); cy < y + h; cy++) {
        for (let cx = Math.floor(x); cx < x + w; cx++) {
            canvas.setPixel(cx, cy * 2, c, z);
            canvas.setPixel(cx, cy * 2 + 1, c, z);
        }
    }
}

export interface PanelStyle {
    border: RGB;
    fill: RGB;
    title?: string;
    titleColor?: RGB;
}

/** A rounded box, like the app's panels. `x, y, w, h` include the border. */
export function drawPanel(canvas: Canvas, x: number, y: number, w: number, h: number, style: PanelStyle): void {
    x = Math.round(x);
    y = Math.round(y);
    w = Math.round(w);
    h = Math.round(h);
    if (w < 2 || h < 2) return;
    fillCells(canvas, x, y, w, h, style.fill);
    const b = style.border;
    canvas.setGlyph(x, y, "╭", b);
    canvas.setGlyph(x + w - 1, y, "╮", b);
    canvas.setGlyph(x, y + h - 1, "╰", b);
    canvas.setGlyph(x + w - 1, y + h - 1, "╯", b);
    for (let i = 1; i < w - 1; i++) {
        canvas.setGlyph(x + i, y, "─", b);
        canvas.setGlyph(x + i, y + h - 1, "─", b);
    }
    for (let j = 1; j < h - 1; j++) {
        canvas.setGlyph(x, y + j, "│", b);
        canvas.setGlyph(x + w - 1, y + j, "│", b);
    }
    if (style.title && w > 6) {
        drawText(canvas, x + 2, y, ` ${style.title} `, style.titleColor ?? b, {
            bold: true,
            solid: true,
            maxWidth: w - 4,
        });
    }
}

const KEY_FACE = hex("#2A2E45");
const KEY_FACE_DOWN = hex("#454C78");
const KEY_SIDE = hex("#151726");

/**
 * A chunky 3D keycap. `press` 0..1 sinks it into its base and lights it up.
 * Returns the keycap's width in cells.
 */
export function drawKeycap(canvas: Canvas, x: number, y: number, label: string, press: number, accent: RGB): number {
    const w = label.length + 4;
    const down = press > 0.5 ? 1 : 0;
    const face = mix(KEY_FACE, KEY_FACE_DOWN, press);
    // Base / side of the key (visible below the face when it's up).
    fillCells(canvas, x, y + 1, w, 3, KEY_SIDE);
    drawPanel(canvas, x, y + down, w, 3, { border: mix(hex("#6C7398"), accent, press), fill: face });
    drawText(canvas, x + 2, y + 1 + down, label, mix(hex("#E6E8F5"), accent, press), { bold: true });
    return w;
}

/** The first `p` fraction of a string, for typewriter reveals. */
export function typed(s: string, p: number): string {
    return s.slice(0, Math.floor(s.length * clamp01(p)));
}

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export const spinner = (t: number): string => SPINNER[Math.floor(t * 12) % SPINNER.length];

/** Parses a display colour ("#rrggbb" or a few named colours) with a fallback. */
export function toRGB(color: string, fallback: RGB = [255, 255, 255]): RGB {
    if (/^#[0-9a-f]{6}$/i.test(color)) return hex(color);
    const named: Record<string, RGB> = { white: [255, 255, 255], black: [0, 0, 0], red: [255, 64, 64] };
    return named[color] ?? fallback;
}

export const fade = (c: RGB, k: number): RGB => scale(c, clamp01(k));

// --- circuit-style connectors ---

export type Cell = readonly [number, number];

/** An orthogonal path: right along `fy` to `midX`, vertically to `ty`, right to `tx`. */
export function elbowPath(fx: number, fy: number, tx: number, ty: number, midX: number): Cell[] {
    const path: Cell[] = [];
    for (let x = fx; x < midX; x++) path.push([x, fy]);
    const dir = Math.sign(ty - fy);
    for (let y = fy; y !== ty; y += dir) path.push([midX, y]);
    for (let x = midX; x <= tx; x++) path.push([x, ty]);
    return path;
}

const L = 1;
const R = 2;
const U = 4;
const D = 8;
const WIRE_CHARS: Record<number, string> = {
    [L | R]: "─",
    [U | D]: "│",
    [L | U]: "╯",
    [L | D]: "╮",
    [R | U]: "╰",
    [R | D]: "╭",
    [L | R | U]: "┴",
    [L | R | D]: "┬",
    [U | D | R]: "├",
    [U | D | L]: "┤",
    [L | R | U | D]: "┼",
    [L]: "─",
    [R]: "─",
    [U]: "│",
    [D]: "│",
};

/**
 * Collects connector paths and draws them with the right box-drawing glyph per cell,
 * so branches sharing a trunk get proper ┬ / ├ junctions.
 */
export class Wires {
    private readonly cells = new Map<string, { x: number; y: number; dirs: number }>();

    /** Adds the first `upto` cells of a path (for a "growing" wire). */
    add(path: Cell[], upto = path.length): void {
        const n = Math.min(path.length, Math.floor(upto));
        for (let i = 0; i < n; i++) {
            const [x, y] = path[i];
            let dirs = 0;
            const link = (j: number) => {
                if (j < 0 || j >= n) return;
                const [nx, ny] = path[j];
                dirs |= nx < x ? L : nx > x ? R : ny < y ? U : D;
            };
            link(i - 1);
            link(i + 1);
            // Path ends still read as a line going in their direction.
            if (i === 0 && n > 1) dirs |= dirs & (L | R) ? L | R : U | D;
            const key = `${x},${y}`;
            const cell = this.cells.get(key) ?? { x, y, dirs: 0 };
            cell.dirs |= dirs;
            this.cells.set(key, cell);
        }
    }

    draw(canvas: Canvas, color: RGB): void {
        for (const { x, y, dirs } of this.cells.values()) {
            const ch = WIRE_CHARS[dirs];
            if (ch) canvas.setGlyph(x, y, ch, color);
        }
    }
}
