// Timing and maths helpers for the intro animation. Everything is a pure function of
// time, so any frame can be rendered on its own (skipping, resizing, snapshot tests).

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Hermite smoothstep; also works with e0 > e1 (inverted ramp). */
export function smoothstep(e0: number, e1: number, x: number): number {
    const t = clamp01((x - e0) / (e1 - e0));
    return t * t * (3 - 2 * t);
}

/** Progress of `t` through the window [start, start + duration], clamped to 0..1. */
export const progress = (t: number, start: number, duration: number): number => clamp01((t - start) / duration);

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

export const easeInOutSine = (t: number): number => -(Math.cos(Math.PI * t) - 1) / 2;

export function easeOutBack(t: number): number {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/** Damped spring settling from 1 to 0 — handy for squash & stretch wobbles. */
export const wobble = (t: number, freq = 3, damping = 5): number =>
    t <= 0 ? 0 : Math.exp(-damping * t) * Math.cos(2 * Math.PI * freq * t);

/** Deterministic pseudo-random in [0,1) for an integer seed. */
export function hash(n: number): number {
    let x = (n | 0) * 374761393 + 668265263;
    x = (x ^ (x >>> 13)) * 1274126177;
    x = x ^ (x >>> 16);
    return (x >>> 0) / 4294967296;
}
