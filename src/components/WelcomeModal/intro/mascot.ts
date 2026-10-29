import { Canvas, RGB, hex, mix, scale } from "./canvas";
import { clamp01, smoothstep } from "./easing";

// The Goblin Malin mascot: a glossy yellow smiley with big dark eyes and an open grin,
// drawn procedurally per pixel so every feature can be animated independently.

export interface MascotPose {
    /** Centre and radius, in pixels. */
    cx: number;
    cy: number;
    r: number;
    /** 0 = eyes hidden in the dark, 1 = the skin around the eyes is fully lit. */
    eyeLight: number;
    /** 0 = only the eyes are visible, 1 = the whole face is lit. */
    reveal: number;
    /** Eye openness, 0 = closed (drawn as a happy "∩" arc), 1 = open. Left/right as seen by the viewer. */
    leftOpen: number;
    rightOpen: number;
    /** Gaze, -1..1. */
    lookX: number;
    lookY: number;
    /** 0 = mouth closed to a line, 1 = wide open grin. */
    mouthOpen: number;
    /** > 0 squashes vertically (stretches horizontally), < 0 stretches. */
    squash: number;
    /** Strength of the warm halo around the face. */
    glow: number;
}

const SKIN_HI = hex("#FFF59A");
const SKIN = hex("#FFCC1F");
const SKIN_EDGE = hex("#F08A0C");
const SKIN_RIM = hex("#B9560A");
const EYE = hex("#2B1400");
const EYE_HI = hex("#FFF6DA");
const MOUTH = hex("#3E0F02");
const MOUTH_TOP = hex("#1E0600");
const TONGUE = hex("#E8452C");
const TONGUE_HI = hex("#FF7A55");
const OUTLINE = hex("#000000");
const HALO = hex("#FF9A1F");

const MASCOT_Z = 2;
const EYE_X = 0.34;
const EYE_Y = -0.22;
const EYE_RX = 0.15;
const EYE_RY = 0.21;
// In the dark, the eyes only catch a faint, wide glow of light — a tight bright ring
// around a tall dark oval reads as a cat's iris and slit pupil.
const EYE_LIGHT_MAX = 0.4;
const DIM_SKIN = hex("#8A5A1E");
const MOUTH_Y = 0.12;

export function drawMascot(canvas: Canvas, p: MascotPose): void {
    const sx = 1 + p.squash;
    const sy = 1 - p.squash;
    const rx = p.r * sx;
    const ry = p.r * sy;
    const haloR = 1.45;

    const x0 = Math.floor(p.cx - rx * haloR);
    const x1 = Math.ceil(p.cx + rx * haloR);
    const y0 = Math.floor(p.cy - ry * haloR);
    const y1 = Math.ceil(p.cy + ry * haloR);
    const aa = 1.2 / p.r; // anti-aliasing band, in normalised units

    const eyes = [
        { ex: -EYE_X + p.lookX * 0.07, open: p.leftOpen },
        { ex: EYE_X + p.lookX * 0.07, open: p.rightOpen },
    ];
    const ey = EYE_Y + p.lookY * 0.05;

    for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
            // Sample the pixel centre in normalised face space.
            const u = (x + 0.5 - p.cx) / rx;
            const v = (y + 0.5 - p.cy) / ry;
            const d = Math.sqrt(u * u + v * v);

            if (d > 1) {
                // Halo + a thin black cut-out ring that separates the face from what's behind it.
                if (d < 1.07 && p.reveal > 0.05) {
                    canvas.setPixel(x, y, OUTLINE, MASCOT_Z);
                } else if (p.glow > 0) {
                    const k = 1 - (d - 1) / (haloR - 1);
                    if (k > 0) canvas.blendPixel(x, y, HALO, k * k * 0.45 * p.glow);
                }
                continue;
            }

            // --- lighting: a spotlight around each eye, then a wipe from the centre outwards ---
            let eyeGlow = 0;
            for (const e of eyes) {
                const dx = (u - e.ex) / 0.55;
                const dy = (v - ey) / 0.6;
                const f = clamp01(1 - Math.sqrt(dx * dx + dy * dy));
                eyeGlow = Math.max(eyeGlow, p.eyeLight * EYE_LIGHT_MAX * f * f);
            }
            const wipe = p.reveal * 1.5;
            const lit = smoothstep(wipe, wipe - 0.35, d);
            const light = Math.max(eyeGlow, lit);
            if (light < 0.03) {
                // Once the reveal starts, the unlit part of the face is a black silhouette,
                // so the title appearing behind it can't show through.
                if (p.reveal > 0) canvas.setPixel(x, y, OUTLINE, MASCOT_Z);
                continue;
            }

            // --- skin: highlight at top-left, warm orange towards the rim ---
            const lx = u + 0.38;
            const ly = v + 0.45;
            const hl = clamp01(1 - Math.sqrt(lx * lx + ly * ly) / 0.75);
            let c: RGB = mix(SKIN, SKIN_EDGE, smoothstep(0.45, 1, d));
            c = mix(c, SKIN_HI, hl * hl * 0.9);
            c = mix(c, SKIN_RIM, smoothstep(0.88, 1, d) * 0.8);
            // Where only the eye glow reaches, the skin is a dull, desaturated amber.
            c = mix(c, DIM_SKIN, clamp01(1 - lit) * 0.6);
            let glint = false;

            // --- eyes ---
            for (const e of eyes) {
                const du = (u - e.ex) / EYE_RX;
                if (e.open > 0.22) {
                    const dv = (v - ey) / (EYE_RY * e.open);
                    if (du * du + dv * dv <= 1) {
                        c = EYE;
                        // Catch-light, up and to the left.
                        const hu = (u - (e.ex - 0.045)) / 0.05;
                        const hv = (v - (ey - EYE_RY * e.open * 0.45)) / 0.06;
                        if (e.open > 0.6 && hu * hu + hv * hv <= 1) {
                            c = EYE_HI;
                            glint = true;
                        }
                    }
                } else {
                    // Closed: a happy upward arc.
                    const ax = u - e.ex;
                    const ay = v - (ey + 0.06);
                    const ad = Math.sqrt(ax * ax + ay * ay);
                    if (ay < 0.02 && Math.abs(ad - 0.12) < 0.035) c = EYE;
                }
            }

            // --- mouth: a "D" grin whose top edge curves up into a smile ---
            const mOpen = Math.max(0.04, p.mouthOpen);
            const top = MOUTH_Y + 0.07 * u * u - 0.02;
            const mu = u / 0.6;
            const mv = (v - MOUTH_Y) / (0.52 * mOpen);
            if (v >= top && mu * mu + mv * mv <= 1) {
                c = mix(MOUTH_TOP, MOUTH, smoothstep(top, top + 0.15, v));
                // Tongue resting at the bottom of the mouth.
                const tu = (u - 0.06) / 0.34;
                const tv = (v - (MOUTH_Y + 0.52 * mOpen)) / (0.3 * mOpen + 0.02);
                if (mOpen > 0.3 && tu * tu + tv * tv <= 1) {
                    c = mix(TONGUE, TONGUE_HI, clamp01(-tv * 0.8));
                }
            }

            // Anti-aliased rim against black.
            const edge = smoothstep(1, 1 - aa, d);
            // The catch-light shines on its own: it's the first thing seen in the dark.
            const k = glint ? Math.max(light, p.eyeLight) : light;
            canvas.setPixel(x, y, scale(c, k * edge), MASCOT_Z);
        }
    }
}
