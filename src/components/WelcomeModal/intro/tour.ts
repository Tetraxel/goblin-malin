import { Canvas, RGB, hex, mix, scale } from "./canvas";
import { clamp01, easeInOutSine, easeOutBack, easeOutCubic, hash, lerp, progress, smoothstep } from "./easing";
import { drawKeycap, drawPanel, drawText, elbowPath, fade, fillCells, spinner, typed, Wires } from "./ui";
import { C, DEMO, provider, SceneDraw, TourLayout, TourOptions } from "./tourShared";
import {
    COMPARE,
    DOWNLOAD,
    downloadProgress,
    drawCompareScene,
    drawDownloadScene,
    drawPreviewScene,
    drawSaveScene,
    PREVIEW,
    SAVE,
} from "./tourSteps";

// The app tour. A stylised task table (like the real one) persists across
// steps while a "detail" area below it plays each step's visual. Everything is a
// function of `tau`, seconds since the tour started (negative while it's opening).

// --- scenes ---

interface Scene {
    title: string;
    subtitle: string;
    duration: number;
    draw: SceneDraw;
}

const SCENES: Scene[] = [
    {
        title: "Paste any music link",
        subtitle: "Spotify, YouTube… tracks, albums or whole playlists",
        duration: 5.2,
        draw: drawPasteScene,
    },
    {
        title: "Fetch metadata",
        subtitle: "Spotify is the primary source, discovery finds the same track elsewhere",
        duration: 7,
        draw: drawFetchScene,
    },
    {
        title: "Compare & compile",
        subtitle: "Reject wrong sources, keep the good ones, edit any field of the Compiled Metadata",
        duration: COMPARE.duration,
        draw: drawCompareScene,
    },
    {
        title: "Download",
        subtitle: "Download providers like YtDlp grab the audio using the link discovered on YouTube",
        duration: DOWNLOAD.duration,
        draw: drawDownloadScene,
    },
    {
        title: "Preview",
        subtitle: "Listen to the file and check its tags before keeping it",
        duration: PREVIEW.duration,
        draw: drawPreviewScene,
    },
    {
        title: "Save",
        subtitle: "Tagged and filed where you want it",
        duration: SAVE.duration,
        draw: drawSaveScene,
    },
];
const STEP_COUNT = SCENES.length;

const sceneStart = (i: number): number => SCENES.slice(0, i).reduce((acc, s) => acc + s.duration, 0);

/** Length of the whole tour, in seconds. */
export const TOUR_DURATION = sceneStart(SCENES.length);
// How long the wipe between two steps takes.
const WIPE = 0.45;

// Key moments, in tour time.
const PASTE = { press1: 1.0, land1: 1.85, press2: 2.7, land2: 3.55, fly: 0.8 };
const FETCH0 = sceneStart(1);
const FETCH = {
    start: FETCH0 + 0.2,
    source: FETCH0 + 0.4,
    fields: FETCH0 + 0.9,
    row: FETCH0 + 1.2,
    edges: FETCH0 + 2.0,
    nodes: [FETCH0 + 2.3, FETCH0 + 2.5, FETCH0 + 2.7],
    travel: 0.6,
    done: FETCH0 + 4.0,
};
const COMPARE0 = sceneStart(2);
const DOWNLOAD0 = sceneStart(3);
const PREVIEW0 = sceneStart(4);
const SAVE0 = sceneStart(5);

export interface MascotHints {
    lookX: number;
    lookY: number;
    /** Mouth flapping while the step caption types in. */
    talking: boolean;
    /** Beat phase (in beats) while music plays, or null. */
    beat: number | null;
}

/** Hints for the guide mascot: where to look, whether it's talking or dancing. */
export function tourMascotHints(tau: number): MascotHints {
    const i = sceneIndex(tau);
    const s = tau - sceneStart(i);
    const talking = s >= 0 && s < 1.2;
    const playing = tau >= PREVIEW0 + PREVIEW.play && tau < SAVE0;
    const beat = playing ? (tau - PREVIEW0 - PREVIEW.play) * (PREVIEW.bpm / 60) : null;
    if (i === 0 && tau > 0.6 && tau < 4) return { lookX: 0.5, lookY: 0.9, talking, beat };
    return { lookX: 0.8 + 0.2 * Math.sin(tau * 0.8), lookY: 0.5, talking, beat };
}

function sceneIndex(tau: number): number {
    for (let i = SCENES.length - 1; i >= 0; i--) if (tau >= sceneStart(i)) return i;
    return 0;
}

export function drawTour(canvas: Canvas, tau: number, l: TourLayout, o: TourOptions): void {
    const i = sceneIndex(tau);
    const s = tau - sceneStart(i);

    drawCaption(canvas, tau, i, s, l);
    drawTable(canvas, tau, l, o);
    if (tau < 0) return;
    if (i === 0 || s >= WIPE) {
        SCENES[i].draw(canvas, s, l, o);
        return;
    }

    // Wipe between steps: the previous step keeps playing right of a glowing scanline,
    // the new one is revealed on its left.
    const d = l.detail;
    const lineX = Math.round(d.x - 3 + (d.w + 6) * easeInOutSine(s / WIPE));
    canvas.setClip(lineX, Infinity);
    SCENES[i - 1].draw(canvas, SCENES[i - 1].duration + s, l, o);
    canvas.setClip(0, lineX);
    SCENES[i].draw(canvas, s, l, o);
    canvas.resetClip();
    for (let y = d.y; y < d.y + d.h; y++) {
        canvas.setGlyph(lineX, y, "▓", C.accent);
        canvas.setGlyph(lineX - 1, y, "▒", fade(C.accent, 0.6));
        canvas.setGlyph(lineX - 2, y, "░", fade(C.accent, 0.3));
    }
}

function drawCaption(canvas: Canvas, tau: number, i: number, s: number, l: TourLayout): void {
    const scene = SCENES[i];
    const x = l.captionX;
    const width = canvas.cols - x - 2;
    if (width < 8) return;
    const mid = Math.floor(l.headerH / 2);
    const appear = smoothstep(-0.3, 0.2, tau);

    // Step dots, current one lit.
    let dots = "";
    for (let k = 0; k < STEP_COUNT; k++) dots += k === i ? "● " : "○ ";
    drawText(canvas, x, mid - 2, `STEP ${i + 1}/${STEP_COUNT}  `, fade(C.muted, appear), { bold: true });
    drawText(canvas, x + 13, mid - 2, dots, fade(C.accent, appear), { maxWidth: width - 13 });

    // Title types in, with a rainbow-ish shimmer per letter; subtitle follows.
    const title = typed(scene.title, progress(s, 0.1, 0.5));
    for (let k = 0; k < title.length; k++) {
        const wave = 0.5 + 0.5 * Math.sin(tau * 3 - k * 0.35);
        const c = mix(hex("#FFE27A"), hex("#FF8A3D"), wave);
        if (k < width) canvas.setGlyph(x + k, mid, title[k], c, false, true);
    }
    if (title.length < scene.title.length && Math.floor(tau * 8) % 2 === 0) {
        canvas.setGlyph(x + title.length, mid, "▌", C.accent);
    }
    drawText(canvas, x, mid + 1, typed(scene.subtitle, progress(s, 0.6, 0.8)), C.muted, { maxWidth: width });
}

// --- the persistent task table ---

interface Column {
    label: string;
    color: RGB;
    w: number;
}

function tableColumns(inner: number): Column[] {
    const sp = provider("spotify");
    const yt = provider("youtube");
    const mb = provider("musicBrainz");
    const fixed = (label: string, color: RGB, frac: number): Column => ({
        label,
        color,
        w: Math.max(3, Math.round(inner * frac)),
    });
    const short = (a: string) => (a.length > 4 ? a.slice(0, 2) : a);
    const cols = [
        fixed("URL", C.border, 0.3),
        fixed("ARTIST", C.border, 0.15),
        fixed("TRACK", C.border, 0.19),
        fixed(short(sp.acronym), sp.color, 0.07),
        fixed(short(yt.acronym), yt.color, 0.07),
        fixed(short(mb.acronym), mb.bright, 0.06),
    ];
    const used = cols.reduce((a, c) => a + c.w, 0);
    cols.push({ label: "STATUS", color: C.border, w: Math.max(4, inner - used) });
    return cols;
}

function drawTable(canvas: Canvas, tau: number, l: TourLayout, o: TourOptions): void {
    const open = easeOutCubic(progress(tau, -0.4, 0.6));
    if (open <= 0) return;
    const t = l.table;
    const w = Math.max(2, Math.round(t.w * open));
    const x = t.x + Math.round((t.w - w) / 2);
    drawPanel(canvas, x, t.y, w, t.h, {
        border: fade(C.border, open),
        fill: C.panel,
        title: "Tasks",
        titleColor: C.accent,
    });
    if (open < 1) return;

    const cols = tableColumns(t.w - 4);
    let cx = t.x + 2;
    for (const c of cols) {
        drawText(canvas, cx, t.y + 1, c.label, c.color, { bold: true, maxWidth: c.w - 1 });
        cx += c.w;
    }

    const sp = provider("spotify");
    const yt = provider("youtube");
    const mb = provider("musicBrainz");
    const rowsY = [t.y + 2, t.y + 3];

    // Nothing pasted yet: the empty-state hint, gently pulsing.
    if (tau < PASTE.land1) {
        const pulse = 0.6 + 0.4 * Math.sin(tau * 4);
        drawText(
            canvas,
            t.x + 2,
            rowsY[0],
            `Press ${o.importKeys.join("+")} to import music URLs`,
            fade(C.muted, pulse)
        );
        return;
    }

    const rows = [
        { land: PASTE.land1, url: "SPOTIFY::TRACK", color: sp.color },
        { land: PASTE.land2, url: "YOUTUBE::VIDEO", color: yt.color },
    ];
    rows.forEach((row, ri) => {
        if (tau < row.land) return;
        const y = rowsY[ri];
        const flash = 1 - smoothstep(0, 0.6, tau - row.land);
        // Each milestone flashes the row green.
        const milestones = [FETCH.done, COMPARE0 + COMPARE.done, DOWNLOAD0 + DOWNLOAD.end, SAVE0 + SAVE.land];
        const doneFlash =
            ri === 0 ? Math.max(0, ...milestones.map((m) => (tau >= m ? 1 - smoothstep(0, 0.8, tau - m) : 0))) : 0;
        fillCells(
            canvas,
            t.x + 1,
            y,
            t.w - 2,
            1,
            mix(mix(C.panel, row.color, flash * 0.5), C.success, doneFlash * 0.35)
        );

        let x = t.x + 2;
        const cell = (k: number, s: string, c: RGB, bold = false) => {
            drawText(canvas, x, y, s, c, { maxWidth: cols[k].w - 1, bold });
            x += cols[k].w;
        };
        cell(0, "↳ " + row.url, row.color, true);
        if (ri === 0) {
            cell(1, typed(DEMO.artist, progress(tau, FETCH.row, 0.4)), C.text);
            cell(2, typed(DEMO.title, progress(tau, FETCH.row + 0.2, 0.5)), C.text);
            cell(3, tau >= FETCH.row ? "6gHq2" : "", sp.color);
            cell(4, tau >= FETCH.nodes[0] + FETCH.travel ? "Jk3wQ" : "", yt.color);
            cell(5, tau >= FETCH.nodes[1] + FETCH.travel ? "✓ 0" : "", mb.bright);
            const [status, color, bold] = rowStatus(tau);
            cell(6, status, color, bold);
        } else {
            for (let k = 1; k < 6; k++) cell(k, "", C.muted);
            cell(6, "Queued", C.muted);
        }
    });
}

/** The first row's status as it moves through the whole pipeline. */
function rowStatus(tau: number): [string, RGB, boolean] {
    if (tau >= SAVE0 + SAVE.land) return ["✓ Saved", C.success, true];
    if (tau >= SAVE0) return [`${spinner(tau)} Saving`, C.accent, false];
    if (tau >= PREVIEW0 + PREVIEW.play) return ["♪ Playing", C.accent, false];
    if (tau >= DOWNLOAD0 + DOWNLOAD.end) return ["✓ Downloaded", C.success, true];
    if (tau >= DOWNLOAD0 + DOWNLOAD.start) {
        return [`↓ ${Math.round(downloadProgress(tau - DOWNLOAD0) * 100)}%`, C.text, false];
    }
    if (tau >= COMPARE0 + COMPARE.done) return ["✓ Compiled", C.success, true];
    if (tau >= COMPARE0) return ["♦ Review", C.accent, false];
    if (tau >= FETCH.done) return ["✓ Fetched", C.success, true];
    if (tau >= FETCH.start)
        return [`${spinner(tau)} ${tau < FETCH.edges ? "Fetching" : "Discovering"}`, C.accent, false];
    return ["Queued", C.muted, false];
}

// --- step 1: paste ---

function drawPasteScene(canvas: Canvas, s: number, l: TourLayout, o: TourOptions): void {
    const d = l.detail;
    const out = smoothstep(4.7, 5.2, s);
    const keys = o.importKeys;
    const gap = 3;
    const totalW = keys.reduce((a, k) => a + k.length + 4, 0) + gap * (keys.length - 1) + 2 * (keys.length - 1);
    const kx = Math.round(d.x + (d.w - totalW) / 2);
    const ky = Math.round(d.y + d.h / 2 - 2 + out * d.h);
    const appear = easeOutBack(progress(s, 0.2, 0.5));
    if (appear <= 0) return;
    const keyY = ky + Math.round((1 - appear) * 4);

    const pressAt = (t0: number) => {
        const k = s - t0;
        return k < 0 ? 0 : k < 0.08 ? k / 0.08 : 1 - smoothstep(0.25, 0.45, k);
    };
    const press = Math.max(pressAt(PASTE.press1), pressAt(PASTE.press2));
    const accent = C.accent;

    let x = kx;
    keys.forEach((k, i) => {
        // The modifier goes down slightly before the letter, like real fingers.
        const p =
            i < keys.length - 1 ? Math.max(press, pressAt(PASTE.press1 - 0.1), pressAt(PASTE.press2 - 0.1)) : press;
        x += drawKeycap(canvas, x, keyY, k, p, accent);
        if (i < keys.length - 1) {
            drawText(canvas, x + 1, keyY + 1, "+", C.muted, { bold: true });
            x += gap + 2;
        }
    });
    const centerX = kx + totalW / 2;
    const centerY = keyY + 1.5;

    // Shockwave ring on each press.
    for (const t0 of [PASTE.press1, PASTE.press2]) {
        const age = s - t0;
        if (age < 0 || age > 0.7) continue;
        const r = 4 + age * 40;
        const n = 48;
        for (let j = 0; j < n; j++) {
            const a = (j / n) * Math.PI * 2;
            canvas.setGlyph(
                centerX + Math.cos(a) * r,
                centerY + Math.sin(a) * r * 0.5,
                "·",
                fade(accent, 1 - age / 0.7),
                true
            );
        }
    }

    // The pasted URLs fly from the keys into the table, trailing sparks.
    const sp = provider("spotify");
    const yt = provider("youtube");
    const flights = [
        { t0: PASTE.press1 + 0.05, url: DEMO.spotifyUrl, color: sp.color, row: 0 },
        { t0: PASTE.press2 + 0.05, url: DEMO.youtubeUrl, color: yt.color, row: 1 },
    ];
    for (const f of flights) {
        const p = (s - f.t0) / PASTE.fly;
        if (p < 0 || p > 1) continue;
        const toX = l.table.x + 4;
        const toY = l.table.y + 2 + f.row;
        const at = (q: number) => {
            const e = easeOutCubic(clamp01(q));
            // Quadratic Bézier arcing up and over.
            const cx = lerp(centerX, toX, 0.5) + 10;
            const cy = Math.min(centerY, toY) - 3;
            const xx = (1 - e) * (1 - e) * (centerX - 10) + 2 * (1 - e) * e * cx + e * e * toX;
            const yy = (1 - e) * (1 - e) * centerY + 2 * (1 - e) * e * cy + e * e * toY;
            return [xx, yy];
        };
        for (let k = 8; k >= 1; k--) {
            const [tx, ty] = at(p - k * 0.03);
            const ch = k < 3 ? "•" : "·";
            canvas.setGlyph(tx + (hash(k) - 0.5) * 2, ty, ch, fade(f.color, 1 - k / 9));
        }
        const [hx, hy] = at(p);
        const label = f.url.replace("https://", "");
        drawText(canvas, hx, hy, label, mix(hex("#FFFFFF"), f.color, p), {
            bold: true,
            maxWidth: Math.max(10, Math.round(30 * (1 - p * 0.5))),
        });
    }
}

// --- step 2: fetch + discovery ---

function drawFetchScene(canvas: Canvas, s: number, l: TourLayout): void {
    const d = l.detail;
    const tau = s + FETCH0;
    const sp = provider("spotify");

    // Source node: the primary platform, with its fields streaming in.
    const fields: [string, string][] = [
        ["Title", DEMO.title],
        ["Artist", DEMO.artist],
        ["Album", DEMO.album],
        ["ISRC", DEMO.isrc],
        ["Length", DEMO.length],
    ].slice(0, Math.max(1, d.h - 3)) as [string, string][];
    const srcW = Math.min(28, Math.round(d.w * 0.3));
    const srcH = fields.length + 2;
    const srcX = d.x + 2;
    const srcY = Math.round(d.y + (d.h - srcH) / 2);
    const pop = easeOutBack(progress(tau, FETCH.source, 0.4));
    if (pop <= 0) return;

    // A packet drops from the table row into the source node.
    const drop = progress(tau, FETCH.start, 0.35);
    if (drop > 0 && drop < 1) {
        canvas.setGlyph(l.table.x + 4, lerp(l.table.y + 2, srcY, easeOutCubic(drop)), "●", sp.color);
    }

    drawPanel(canvas, srcX, srcY, Math.max(4, Math.round(srcW * pop)), srcH, {
        border: sp.color,
        fill: C.panel,
        title: `${sp.label} · primary`,
        titleColor: sp.bright,
    });
    if (pop >= 0.95) {
        fields.forEach(([k, v], i) => {
            const p = progress(tau, FETCH.fields + i * 0.12, 0.35);
            if (p <= 0) return;
            drawText(canvas, srcX + 2, srcY + 1 + i, k, C.muted);
            drawText(canvas, srcX + 10, srcY + 1 + i, typed(v, p), C.text, { maxWidth: srcW - 12 });
        });
    }

    // Discovery nodes, fed by packets travelling along circuit-style wires that branch
    // off a shared trunk.
    const yt = provider("youtube");
    const mb = provider("musicBrainz");
    const sl = provider("songlink");
    const nodes = [
        { p: yt, found: "youtu.be/Jk3wQ9mX2pE" },
        { p: mb, found: "recording 7f2c…" },
        { p: sl, found: "found on 9 platforms" },
    ];
    const nodeW = Math.min(30, Math.round(d.w * 0.32));
    const nodeX = d.x + d.w - nodeW - 2;
    const spacing = Math.max(3, Math.min(4, Math.floor(d.h / nodes.length)));
    const firstY = Math.round(d.y + (d.h - spacing * nodes.length) / 2);
    const fromX = srcX + srcW;
    const fromY = Math.round(srcY + srcH / 2);
    const trunkX = Math.round(lerp(fromX, nodeX, 0.45));

    if (tau >= FETCH.edges) {
        drawText(canvas, trunkX - 4, firstY - 1, "discovery", C.dim, { bold: true });
    }

    const paths = nodes.map((_, i) => elbowPath(fromX, fromY, nodeX - 1, firstY + i * spacing + 1, trunkX));
    const wires = new Wires();
    paths.forEach((path, i) => wires.add(path, path.length * easeOutCubic(progress(tau, FETCH.edges + i * 0.1, 0.5))));
    wires.draw(canvas, C.dim);

    nodes.forEach((n, i) => {
        const ny = firstY + i * spacing;
        const path = paths[i];
        const t0 = FETCH.nodes[i];
        const arrive = t0 + FETCH.travel;
        // The first packet, then a steady flow so the graph keeps moving.
        const packets: number[] = [];
        if (tau >= t0 && tau < arrive) packets.push((tau - t0) / FETCH.travel);
        if (tau >= arrive) packets.push(((tau - arrive) * 0.6 + i * 0.33) % 1);
        for (const q of packets) {
            for (let k = 0; k < 3; k++) {
                const qq = q - k * 0.035;
                if (qq < 0) continue;
                const [px, py] = path[Math.min(path.length - 1, Math.floor(qq * path.length))];
                const ch = k === 0 ? "●" : k === 1 ? "•" : "·";
                const c = mix(sp.color, n.p.color, qq);
                canvas.setGlyph(px, py, ch, tau >= arrive ? fade(c, 0.75) : c);
            }
        }

        const nodePop = easeOutBack(progress(tau, t0, 0.35));
        if (nodePop <= 0) return;
        const found = tau >= arrive;
        const arriveFlash = found ? 1 - smoothstep(0, 0.5, tau - arrive) : 0;
        drawPanel(canvas, nodeX, ny, Math.max(4, Math.round(nodeW * nodePop)), 3, {
            border: found ? n.p.color : C.dim,
            fill: mix(C.panel, n.p.color, arriveFlash * 0.4),
            title: n.p.label,
            titleColor: found ? n.p.bright : C.muted,
        });
        if (nodePop < 0.95) return;
        if (found) {
            drawText(canvas, nodeX + 2, ny + 1, "✓", C.success, { bold: true });
            drawText(canvas, nodeX + 4, ny + 1, typed(n.found, progress(tau, arrive, 0.3)), C.text, {
                maxWidth: nodeW - 6,
            });
        } else {
            drawText(canvas, nodeX + 2, ny + 1, `${spinner(tau)} searching…`, C.muted);
        }
    });

    // All sources in: a success sparkle on the source node.
    if (tau >= FETCH.done) {
        const age = tau - FETCH.done;
        for (let k = 0; k < 10 && age < 1; k++) {
            const a = hash(k) * Math.PI * 2;
            const r = age * 12 * (0.5 + hash(k + 50));
            canvas.setGlyph(
                srcX + srcW / 2 + Math.cos(a) * r,
                srcY + Math.sin(a) * r * 0.5,
                k % 2 ? "+" : "•",
                fade(scale(C.success, 1.1), 1 - age),
                true
            );
        }
    }
}
