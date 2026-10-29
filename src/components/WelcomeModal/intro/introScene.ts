import { Canvas, RGB, hex, mix } from "./canvas";
import { easeInOutSine, easeOutBack, easeOutCubic, lerp, progress, smoothstep, wobble } from "./easing";
import { drawLogo, LogoLine, TEXT_HEIGHT, textWidth } from "./logo";
import { drawMascot, MascotPose } from "./mascot";
import { drawBurst, drawDust, drawOrbit } from "./particles";
import { drawTour, TOUR_DURATION, tourMascotHints } from "./tour";
import { TourLayout, tourLayout, TourOptions } from "./tourShared";
import { drawText, fade } from "./ui";

// Scene 1 — "the awakening":
//   black → dust → the eyes open in the dark and look around → wink: the face lights up,
//   sparks burst and "GOBLIN / MALIN" scrambles into place behind him → idle.
// Then the title dissolves, the mascot shrinks into the corner as a guide, and the
// app tour (tour.ts) plays. Finale: the tour wipes away, the mascot comes back to the
// centre, winks again and the title re-forms. Times are in seconds.

export const T = {
    DUST_IN: 0.3,
    EYES_IN: 0.9,
    WINK: 2.9,
    LOGO_IN: 3.05,
    LOGO_DURATION: 1.2,
    IDLE: 4.4,
    /** The title dissolves and the mascot moves to its guide spot. */
    TOUR: 6.2,
    TOUR_MOVE: 0.9,
    /** Tour time zero (its table opens slightly before). */
    TOUR_START: 7.2,
    /** The tour is over: wipe it away and bring the mascot back to the centre. */
    FINALE: 7.2 + TOUR_DURATION,
} as const;

const FINALE = {
    WIPE: 0.6,
    BACK: 0.9,
    WINK: T.FINALE + 1.0,
    LOGO_IN: T.FINALE + 1.1,
    PROMPT: T.FINALE + 2.4,
};

/** Closing animation: the content fades out while the mascot shrinks onto a target. */
export interface IntroOutro {
    /** 0..1 progress of the outro. */
    k: number;
    /** Target cell (the toolbar's 😉), in terminal cells. */
    x: number;
    y: number;
    /** Colour to fade towards (the app's background). */
    background: RGB;
    /** Rows below the scene (the footer) that the outro covers too. */
    extraRows: number;
}

/** Linear keyframes [time, value], eased between neighbours. */
function keyframes(t: number, frames: [number, number][]): number {
    if (t <= frames[0][0]) return frames[0][1];
    for (let i = 1; i < frames.length; i++) {
        const [t1, v1] = frames[i];
        if (t <= t1) {
            const [t0, v0] = frames[i - 1];
            return lerp(v0, v1, easeInOutSine((t - t0) / (t1 - t0)));
        }
    }
    return frames[frames.length - 1][1];
}

function mascotPose(t: number, cx: number, cy: number, r: number, guide: TourLayout["mascot"]): MascotPose {
    const reveal = easeOutCubic(progress(t, T.WINK, 0.7));
    const pop = progress(t, T.WINK, 0.6);
    const idle = t - T.IDLE;

    // Eyes slowly open in the dark, peek left, right, then back at the viewer.
    let open = easeOutCubic(progress(t, T.EYES_IN + 0.2, 0.5));
    let lookX = keyframes(t, [
        [1.7, 0],
        [1.95, -1],
        [2.3, -1],
        [2.5, 1],
        [2.75, 1],
        [2.95, 0],
    ]);
    let lookY = keyframes(t, [
        [1.7, 0],
        [1.95, 0.4],
        [2.75, 0.4],
        [2.95, 0],
    ]);

    // Idle: a lazy gaze drift and a blink every few seconds.
    if (idle > 0) {
        const ramp = smoothstep(0, 1.5, idle);
        lookX = Math.sin(idle * 0.7) * 0.6 * ramp;
        lookY = Math.sin(idle * 0.45 + 1) * 0.3 * ramp;
        const blink = (idle + 1.5) % 4.2;
        if (blink < 0.18) open = 1 - Math.sin((blink / 0.18) * Math.PI);
    }

    // The wink (viewer's right eye): snap shut, hold, pop back open. Again at the finale.
    const winkAt = (w: number) =>
        keyframes(t, [
            [w - 0.02, 1],
            [w + 0.08, 0],
            [w + 0.6, 0],
            [w + 0.75, 1],
        ]);
    const wink = Math.min(winkAt(T.WINK), winkAt(FINALE.WINK));

    const bob = idle > 0 ? Math.sin(idle * 2.1) * r * 0.04 : 0;
    let squash = 0.14 * wobble(t - T.WINK, 2.2, 4) * smoothstep(0, 0.06, t - T.WINK);

    // Fly to the guide spot, stretching along the way and landing with a little squash…
    const move = easeInOutSine(progress(t, T.TOUR, T.TOUR_MOVE));
    // …and back to the centre for the finale.
    const back = easeInOutSine(progress(t, T.FINALE, FINALE.BACK));
    const guided = move * (1 - back);
    let mouthOpen = lerp(0.15, 1, easeOutBack(pop));
    let dance = 0;
    if (guided > 0) {
        const hints = tourMascotHints(t - T.TOUR_START);
        lookX = lerp(lookX, hints.lookX, guided);
        lookY = lerp(lookY, hints.lookY, guided);
        if (hints.talking) mouthOpen = 0.45 + 0.55 * Math.abs(Math.sin(t * 13));
        // Bounce on the beat while the preview plays.
        if (hints.beat !== null) {
            const phase = hints.beat % 1;
            dance = Math.abs(Math.sin(phase * Math.PI));
            squash += 0.1 * Math.exp(-8 * phase);
        }
    }
    if (move > 0) {
        squash += -0.12 * Math.sin(move * Math.PI) + 0.12 * wobble(t - T.TOUR - T.TOUR_MOVE, 2.5, 5);
        squash += -0.12 * Math.sin(back * Math.PI) + 0.14 * wobble(t - T.FINALE - FINALE.BACK, 2.2, 4);
    }

    const centreR = r * lerp(0.86, 1, easeOutBack(pop));
    return {
        cx: lerp(cx, guide.cx, guided),
        cy: lerp(cy + bob, guide.cy + bob * 0.5 - dance * guide.r * 0.25, guided),
        r: lerp(centreR, guide.r, guided),
        eyeLight: easeOutCubic(progress(t, T.EYES_IN, 1)),
        reveal,
        leftOpen: open,
        rightOpen: Math.min(open, wink),
        lookX,
        lookY,
        mouthOpen,
        squash,
        glow: reveal * (0.8 + 0.2 * Math.sin(t * 2.4)) * (1 - guided * 0.5),
    };
}

/** Centre-stage layout for `cols` × `rows` cells (in pixels: rows × 2 tall). */
function layout(cols: number, rows: number) {
    const pw = cols;
    const ph = rows * 2;
    const cx = pw / 2;
    const cy = ph / 2;
    const r = Math.max(7, Math.min(ph * 0.25, pw * 0.17));

    // Two title rows, with the face overlapping their inner edges.
    const gap = r * 0.95;
    const wide = textWidth("GOBLIN");
    const size = Math.max(1, Math.floor(Math.min((pw * 0.94) / wide, (cy - gap - 1) / TEXT_HEIGHT)));
    const h = TEXT_HEIGHT * size;
    const line = (text: string, y: number): LogoLine => ({
        text,
        x: Math.round(cx - (textWidth(text) * size) / 2),
        y: Math.round(y),
        size,
    });
    const lines = [line("GOBLIN", cy - gap - h), line("MALIN", cy + gap)];
    return { cx, cy, r, lines };
}

/** How far the content has faded out (0..1) at outro progress `k`; done before the mascot lands. */
const outroFade = (k: number): number => easeInOutSine(Math.min(1, k / 0.7));

/** The canvas background during the outro: black fading into the app's background. */
export function outroBackground(outro?: IntroOutro): RGB {
    return outro ? mix([0, 0, 0], outro.background, outroFade(outro.k)) : [0, 0, 0];
}

/**
 * Renders one frame of the intro at time `t` (seconds). The scene is laid out for
 * `cols` × `rows`; during the outro the canvas grows by `outro.extraRows` to also cover
 * the footer, without moving anything.
 */
export function renderIntroCanvas(
    t: number,
    cols: number,
    rows: number,
    options: TourOptions,
    outro?: IntroOutro
): Canvas {
    const fadeK = outro ? outroFade(outro.k) : 0;
    const canvas = new Canvas(cols, rows + (outro?.extraRows ?? 0), outroBackground(outro));
    const { cx, cy, r, lines } = layout(cols, rows);
    const tour = tourLayout(cols, rows);
    const pose = mascotPose(t, cx, cy, r, tour.mascot);

    // Depth order is handled by the canvas: tour UI → mascot → title → shadow; glyphs
    // marked "behind" vanish under solid pixels. While closing, the mascot is drawn last,
    // on top of the faded content.
    if (!outro) drawMascot(canvas, pose);
    drawLogo(canvas, lines, t, T.LOGO_IN, T.LOGO_DURATION, T.TOUR);
    if (t >= T.FINALE) drawLogo(canvas, lines, t, FINALE.LOGO_IN, T.LOGO_DURATION);
    drawTourWithWipeOut(canvas, t, tour, options);
    drawDust(canvas, t, 0.8 * progress(t, T.DUST_IN, 1.2) + 0.2 * progress(t, T.WINK, 0.5));

    // Particles live in cell space (half the pixel height).
    drawBurst(canvas, t, T.WINK + 0.05, cx, pose.cy / 2, r * 1.6);
    drawBurst(canvas, t, FINALE.WINK + 0.05, cx, pose.cy / 2, r * 1.6);
    const orbit =
        smoothstep(T.WINK + 0.4, T.IDLE, t) * (1 - smoothstep(T.TOUR, T.TOUR + 0.4, t)) +
        smoothstep(FINALE.WINK, FINALE.WINK + 1, t);
    drawOrbit(canvas, t, pose.cx, pose.cy / 2, pose.r, orbit);
    drawClosePrompt(canvas, t, options, rows);

    if (outro) {
        canvas.fadeToBackground(fadeK);
        drawIris(canvas, outro);
        drawMascot(canvas, outroPose(pose, outro));
    }
    return canvas;
}

/**
 * The outro's reveal: a hole opening from the toolbar's 😉 until it covers the screen,
 * showing the app through it — a real fade into the app rather than a cut. Its edge is
 * a soft ring of shade glyphs.
 */
function drawIris(canvas: Canvas, outro: IntroOutro): void {
    const hx = outro.x + 1;
    const hy = outro.y + 0.5;
    const aspect = 2.1; // cells are about twice as tall as wide
    const dist = (cx: number, cy: number) => Math.hypot(cx + 0.5 - hx, (cy + 0.5 - hy) * aspect);
    const maxD = dist(canvas.cols, canvas.rows) + 4;
    const radius = maxD * Math.pow(smoothstep(0.05, 0.95, outro.k), 1.4);
    if (radius <= 0) return;
    // The toolbar's 😉 (two cells wide) stays covered until the shrinking face lands on
    // it, so the face is never seen twice.
    const isEmoji = (cx: number, cy: number) => cy === outro.y && (cx === outro.x || cx === outro.x + 1);
    canvas.punchHole((cx, cy) => dist(cx, cy) < radius && !isEmoji(cx, cy));

    const accent = mix(hex("#FFCC1F"), outro.background, outroFade(outro.k) * 0.6);
    const ring = ["░", "▒", "░"];
    for (let cy = 0; cy < canvas.rows; cy++) {
        for (let cx = 0; cx < canvas.cols; cx++) {
            const band = dist(cx, cy) - radius;
            if (band >= 0 && band < ring.length) canvas.setGlyph(cx, cy, ring[Math.floor(band)], accent);
        }
    }
}

/** The tour, wiped away by a scanline sweeping left→right once it's over. */
function drawTourWithWipeOut(canvas: Canvas, t: number, tour: TourLayout, options: TourOptions): void {
    if (t < T.TOUR || t > T.FINALE + FINALE.WIPE) return;
    const wipe = progress(t, T.FINALE, FINALE.WIPE);
    const lineX = Math.round(-3 + (canvas.cols + 6) * easeInOutSine(wipe));
    if (wipe > 0) canvas.setClip(lineX, Infinity);
    drawTour(canvas, t - T.TOUR_START, tour, options);
    canvas.resetClip();
    if (wipe > 0 && wipe < 1) {
        const accent = hex("#FFCC1F");
        for (let y = 0; y < canvas.rows; y++) {
            canvas.setGlyph(lineX, y, "▓", accent);
            canvas.setGlyph(lineX - 1, y, "▒", fade(accent, 0.6));
            canvas.setGlyph(lineX - 2, y, "░", fade(accent, 0.3));
        }
    }
}

/** "Press [Esc] to start", pulsing under the title once the finale settles. */
function drawClosePrompt(canvas: Canvas, t: number, options: TourOptions, rows: number): void {
    const appear = smoothstep(FINALE.PROMPT, FINALE.PROMPT + 0.6, t);
    if (appear <= 0) return;
    const before = "Press ";
    const key = `[${options.closeKey}]`;
    const after = " to start";
    const x = Math.round((canvas.cols - before.length - key.length - after.length) / 2);
    const y = rows - 1;
    const pulse = appear * (0.65 + 0.35 * Math.sin(t * 3));
    const muted = fade(hex("#9AA0BC"), pulse);
    drawText(canvas, x, y, before, muted);
    drawText(canvas, x + before.length, y, key, fade(hex("#FFCC1F"), pulse), { bold: true });
    drawText(canvas, x + before.length + key.length, y, after, muted);
}

/** Shrinks the mascot onto the target cell, winking as it lands — like 😉. */
function outroPose(pose: MascotPose, outro: IntroOutro): MascotPose {
    const e = easeInOutSine(outro.k);
    // The emoji is two cells wide and one tall: aim at its middle, in pixels.
    const tx = outro.x + 1;
    const ty = outro.y * 2 + 1;
    // Closing early (e.g. while only the eyes are visible) still shows the whole face.
    const lit = smoothstep(0, 0.3, outro.k);
    return {
        ...pose,
        reveal: Math.max(pose.reveal, lit),
        eyeLight: Math.max(pose.eyeLight, lit),
        leftOpen: Math.max(pose.leftOpen, lit),
        cx: lerp(pose.cx, tx, e),
        cy: lerp(pose.cy, ty, e),
        r: lerp(pose.r, 1.3, e),
        rightOpen: Math.min(pose.rightOpen, 1 - smoothstep(0.55, 0.8, outro.k)),
        glow: pose.glow * (1 - e),
        squash: pose.squash * (1 - e) + 0.1 * Math.sin(e * Math.PI),
    };
}
