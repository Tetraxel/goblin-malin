import { Canvas, RGB, hex, hsv, mix, scale } from "./canvas";
import { hash, smoothstep } from "./easing";

// The big two-row "GOBLIN / MALIN" title: a 5×7 pixel font scaled up, with a moving
// rainbow sheen and a drop shadow. It materialises as scrambling ASCII glyphs that
// "lock" into solid pixels with a white flash.

const FONT: Record<string, string[]> = {
    G: [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".###."],
    O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
    B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
    L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
    I: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
    N: ["#...#", "##..#", "##..#", "#.#.#", "#..##", "#..##", "#...#"],
    M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
    A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
};

const GLYPH_W = 5;
const GLYPH_H = 7;
const SCRAMBLE = "@#%&$*+=?!/\\<>[]{}01";
const SHADOW = hex("#1C0A33");
const WHITE: RGB = [255, 255, 255];

export const textWidth = (text: string): number => text.length * (GLYPH_W + 1) - 1;
export const TEXT_HEIGHT = GLYPH_H;

export interface LogoLine {
    text: string;
    /** Top-left corner in pixels, and pixel size of one font dot. */
    x: number;
    y: number;
    size: number;
}

/**
 * @param t        seconds since the scene started
 * @param start    when the reveal begins
 * @param duration how long the left→right reveal sweep takes
 * @param dissolveAt when the title breaks back up into rising glyphs (Infinity = never)
 */
export function drawLogo(
    canvas: Canvas,
    lines: LogoLine[],
    t: number,
    start: number,
    duration: number,
    dissolveAt = Infinity
): void {
    const local = t - start;
    if (local < 0) return;
    const frame = Math.floor(t * 30);

    lines.forEach((line, li) => {
        const { size } = line;
        const shadow = Math.max(1, Math.round(size / 2));

        for (let ci = 0; ci < line.text.length; ci++) {
            const rowsOf = FONT[line.text[ci]];
            if (!rowsOf) continue;
            for (let gy = 0; gy < GLYPH_H; gy++) {
                for (let gx = 0; gx < GLYPH_W; gx++) {
                    if (rowsOf[gy][gx] !== "#") continue;
                    const px = line.x + (ci * (GLYPH_W + 1) + gx) * size;
                    const py = line.y + gy * size;

                    // Each dot settles at its own time: a left→right sweep plus jitter.
                    const seed = li * 10007 + ci * 131 + gy * 7 + gx;
                    const sweep = (px - lines[0].x) / Math.max(1, textWidth(line.text) * size);
                    const settle = sweep * duration * 0.75 + hash(seed) * duration * 0.25 + li * 0.15;
                    const since = local - settle;

                    if (since < -0.35) continue;

                    // Dissolve: right→left, each dot becomes a glyph drifting up and fading.
                    const gone = t - (dissolveAt + (1 - sweep) * 0.3 + hash(seed + 7) * 0.35);
                    if (gone >= 0) {
                        const life = 0.9;
                        if (gone > life) continue;
                        const k = gone / life;
                        const ch = SCRAMBLE[Math.floor(hash(seed * 17 + frame) * SCRAMBLE.length)];
                        const dx = (hash(seed + 3) - 0.5) * 24 * gone;
                        const dy = -(4 + hash(seed + 5) * 10) * gone;
                        const c = scale(sheen(px, py, t, canvas), 1 - k * k);
                        canvas.setGlyph(px + size / 2 + dx, (py + size / 2) / 2 + dy, ch, c, true);
                        continue;
                    }

                    if (since < 0) {
                        // Scramble phase: one random glyph per font dot, flickering.
                        const ch = SCRAMBLE[Math.floor(hash(seed * 31 + frame) * SCRAMBLE.length)];
                        const c = sheen(px, py + size / 2, t, canvas);
                        canvas.setGlyph(px + size / 2, (py + size / 2) / 2, ch, c, true);
                        continue;
                    }

                    const flash = 1 - smoothstep(0, 0.25, since);
                    for (let oy = 0; oy < size; oy++) {
                        for (let ox = 0; ox < size; ox++) {
                            canvas.setPixel(px + ox + shadow, py + oy + shadow, SHADOW, 0);
                        }
                    }
                    for (let oy = 0; oy < size; oy++) {
                        for (let ox = 0; ox < size; ox++) {
                            // Darker towards the bottom of each dot gives the letters some volume.
                            const shade = 1 - (oy / size) * 0.25 - (gy / GLYPH_H) * 0.2;
                            const c = scale(sheen(px + ox, py + oy, t, canvas), shade);
                            canvas.setPixel(px + ox, py + oy, mix(c, WHITE, flash), 1);
                        }
                    }
                }
            }
        }
    });
}

/** A diagonal rainbow that slowly scrolls across the title. */
function sheen(x: number, y: number, t: number, canvas: Canvas): RGB {
    const h = (x / canvas.pw) * 0.75 + (y / canvas.ph) * 0.2 - t * 0.07;
    // A brighter band periodically sweeps across like light on metal.
    const band = Math.max(0, 1 - Math.abs(((x + y * 0.5) / canvas.pw - ((t * 0.25) % 1.6) + 0.3) * 6));
    return mix(hsv(h, 0.72, 0.92), WHITE, band * 0.45);
}
