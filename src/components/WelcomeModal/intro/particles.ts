import { Canvas, RGB, hex, hsv, mix, scale } from "./canvas";
import { clamp01, hash } from "./easing";

// Stateless particle systems: each particle's position is a closed-form function of
// time and its seed, so there's nothing to simulate or reset when the terminal resizes.

const DUST_CHARS = ["·", ".", "∙", "˙", "·"];
const DUST = hex("#4B4F86");
const DUST_HI = hex("#9AA3FF");

/** Slow drifting specks in the background, twinkling. Hidden behind solid shapes. */
export function drawDust(canvas: Canvas, t: number, intensity: number): void {
    if (intensity <= 0) return;
    const count = Math.floor((canvas.cols * canvas.rows) / 45);
    for (let i = 0; i < count; i++) {
        const vx = (hash(i * 3 + 1) - 0.5) * 1.6;
        const vy = -0.25 - hash(i * 3 + 2) * 0.6; // gently rising
        const x = mod(hash(i * 3) * canvas.cols + vx * t, canvas.cols);
        const y = mod(hash(i * 7 + 5) * canvas.rows + vy * t, canvas.rows);
        const twinkle = 0.5 + 0.5 * Math.sin(t * (1 + hash(i) * 3) + i);
        const k = intensity * (0.25 + 0.75 * twinkle);
        if (k < 0.12) continue;
        const ch = DUST_CHARS[i % DUST_CHARS.length];
        canvas.setGlyph(x, y, ch, scale(mix(DUST, DUST_HI, twinkle * twinkle), k), true);
    }
}

// Only glyphs present in both Cascadia Mono and Consolas — anything else falls back to
// another font (often double-width) or renders as a tofu box.
const ORBIT_CHARS = ["♦", "◦", "+", "·", "*", "•"];

/** Twinkling sparkles orbiting around a point (cell coordinates), in front of everything. */
export function drawOrbit(canvas: Canvas, t: number, cx: number, cy: number, radius: number, intensity: number): void {
    if (intensity <= 0) return;
    const count = 14;
    for (let i = 0; i < count; i++) {
        const speed = (0.25 + hash(i * 5) * 0.35) * (i % 2 ? 1 : -1);
        const a = hash(i * 5 + 1) * Math.PI * 2 + t * speed;
        const rr = radius * (1.15 + hash(i * 5 + 2) * 0.45) + Math.sin(t * 1.3 + i) * 0.8;
        const x = cx + Math.cos(a) * rr;
        const y = cy + Math.sin(a) * rr * 0.5; // cells are twice as tall as wide
        const life = Math.sin(t * (0.8 + hash(i * 5 + 3)) * 2 + i * 1.7);
        if (life < 0.15) continue;
        const ch = ORBIT_CHARS[Math.floor(life * 3.5) % ORBIT_CHARS.length];
        const c = mix(hex("#FFE27A"), hsv(hash(i) + t * 0.05, 0.6, 1), 0.4);
        canvas.setGlyph(x, y, ch, scale(c, intensity * clamp01(life * 1.4)));
    }
}

const BURST_CHARS = ["*", "♦", "+", "•", "·", "°"];
const BURST_HOT = hex("#FFFBE0");
const BURST_MID = hex("#FFC21F");
const BURST_COLD = hex("#E0401A");

/** A one-shot radial explosion of sparks (cell coordinates), starting at `t0`. */
export function drawBurst(canvas: Canvas, t: number, t0: number, cx: number, cy: number, reach: number): void {
    const age = t - t0;
    const life = 1.4;
    if (age < 0 || age > life) return;
    const count = 60;
    for (let i = 0; i < count; i++) {
        const a = hash(i * 11) * Math.PI * 2;
        const speed = reach * (0.5 + hash(i * 11 + 1) * 0.8);
        const ownLife = life * (0.55 + hash(i * 11 + 2) * 0.45);
        const k = age / ownLife;
        if (k >= 1) continue;
        // Fast start with drag, plus a little gravity.
        const dist = speed * (1 - Math.exp(-3.2 * age));
        const x = cx + Math.cos(a) * dist;
        const y = cy + Math.sin(a) * dist * 0.5 + age * age * 2.5;
        const c: RGB = k < 0.35 ? mix(BURST_HOT, BURST_MID, k / 0.35) : mix(BURST_MID, BURST_COLD, (k - 0.35) / 0.65);
        const ch = BURST_CHARS[Math.min(BURST_CHARS.length - 1, Math.floor(k * BURST_CHARS.length))];
        canvas.setGlyph(x, y, ch, scale(c, 1 - k * k));
    }
}

function mod(a: number, n: number): number {
    return ((a % n) + n) % n;
}
