import { Canvas, RGB, hex, hsv, mix, scale } from "./canvas";
import { clamp01, easeInOutSine, easeOutBack, easeOutCubic, hash, lerp, progress, smoothstep, wobble } from "./easing";
import { drawPanel, drawText, fade, fillCells, spinner, typed, UI_Z } from "./ui";
import { C, DEMO, provider, Rect, TourLayout } from "./tourShared";

// Tour steps 3–6: compare & compile, download, preview, save. Each step's key moments
// are in step-local seconds; the task table (tour.ts) reads them to update its row.

const WHITE: RGB = [255, 255, 255];

// =====================================================================================
// Step 3 — compare sources, reject the wrong one, compile, edit an attribute
// =====================================================================================

export const COMPARE = {
    duration: 8.5,
    grid: 0.25,
    flag: 1.8,
    reject: 2.6,
    accept: 3.2,
    compile: 3.6,
    select: 4.9,
    edit: 5.4,
    done: 7.0,
};

interface FieldRow {
    k: string;
    sp: string;
    yt: string;
    mb: string;
    pick: string;
    /** Filled in by hand in the Compiled Metadata column. */
    edit?: string;
}

const FIELDS: FieldRow[] = [
    { k: "Title", sp: DEMO.title, yt: `${DEMO.title} (Official Video)`, mb: DEMO.title, pick: DEMO.title },
    { k: "Artist", sp: DEMO.artist, yt: "NovaDriftVEVO", mb: DEMO.artist, pick: DEMO.artist },
    { k: "Album", sp: DEMO.album, yt: "", mb: DEMO.album, pick: DEMO.album },
    { k: "Year", sp: DEMO.year, yt: "2023", mb: DEMO.year, pick: DEMO.year },
    { k: "Length", sp: DEMO.length, yt: "3:52", mb: DEMO.length, pick: DEMO.length },
    { k: "Genre", sp: "", yt: "", mb: "", pick: "", edit: DEMO.genre },
];

export function drawCompareScene(canvas: Canvas, s: number, l: TourLayout): void {
    const d = l.detail;
    const sp = provider("spotify");
    const yt = provider("youtube");
    const mb = provider("musicBrainz");

    // Keep as many rows as fit, but always the edited one.
    const fit = Math.max(2, d.h - 3);
    const fields = fit >= FIELDS.length ? FIELDS : [...FIELDS.slice(0, fit - 1), FIELDS[FIELDS.length - 1]];

    const gridW = Math.min(d.w - 2, 124);
    const gridH = fields.length + 3;
    const gx = Math.round(d.x + (d.w - gridW) / 2);
    const gy = d.y + Math.max(0, Math.floor((d.h - gridH) / 3));
    const labelW = 9;
    const colW = Math.floor((gridW - 4 - labelW) / 4);
    const colX = (c: number) => gx + 2 + labelW + c * colW;
    const rowY = (r: number) => gy + 2 + r;

    const open = easeOutCubic(progress(s, 0, 0.4));
    if (open <= 0) return;
    const done = s >= COMPARE.done;
    drawPanel(canvas, gx, gy, Math.max(4, Math.round(gridW * open)), gridH, {
        border: done ? mix(C.success, C.border, smoothstep(0, 1, s - COMPARE.done)) : C.border,
        fill: C.panel,
        title: "Compare sources",
        titleColor: C.accent,
    });
    if (open < 1) return;

    const rejected = s >= COMPARE.reject;
    const accepted = s >= COMPARE.accept;
    const sources = [
        { p: sp, key: "sp" as const, ok: accepted, bad: false },
        { p: yt, key: "yt" as const, ok: false, bad: rejected },
        { p: mb, key: "mb" as const, ok: accepted, bad: false },
    ];

    // The YouTube column gets "looked at" before it's rejected.
    const scrutiny = s >= COMPARE.flag && s < COMPARE.reject + 0.4;
    if (scrutiny) {
        const pulse = 0.5 + 0.5 * Math.sin(s * 10);
        fillCells(canvas, colX(1) - 1, gy + 1, colW, fields.length + 1, mix(C.panel, C.error, 0.12 + pulse * 0.08));
    }

    // Headers.
    sources.forEach((src, c) => {
        const x = colX(c);
        drawText(canvas, x, gy + 1, src.p.label, src.bad ? fade(src.p.color, 0.5) : src.p.color, {
            bold: true,
            maxWidth: colW - 4,
        });
        const mark = src.bad ? "✗" : src.ok ? "✓" : "";
        if (mark)
            drawText(
                canvas,
                x + Math.min(src.p.label.length, colW - 4) + 1,
                gy + 1,
                mark,
                src.bad ? C.error : C.success,
                { bold: true }
            );
    });
    const compiledHeader = done ? C.success : C.accent;
    drawText(canvas, colX(3), gy + 1, "Compiled Metadata", compiledHeader, { bold: true, maxWidth: colW - 1 });

    // Field labels, with a selector that walks down to the field being edited.
    const editRow = fields.length - 1;
    const sel = progress(s, COMPARE.select, 0.45);
    fields.forEach((f, r) => {
        drawText(canvas, gx + 2, rowY(r), f.k, C.muted, { maxWidth: labelW - 1 });
    });
    if (s >= COMPARE.select && s < COMPARE.done + 0.3) {
        const r = Math.round(lerp(0, editRow, easeInOutSine(sel)));
        canvas.setGlyph(gx + 1, rowY(r), "▸", C.accent, false, true);
    }

    // Source values.
    fields.forEach((f, r) => {
        sources.forEach((src, c) => {
            const v = f[src.key];
            if (!v) {
                if (s > COMPARE.grid + c * 0.25 + 0.3) drawText(canvas, colX(c), rowY(r), "—", C.dim);
                return;
            }
            const p = progress(s, COMPARE.grid + c * 0.25 + r * 0.05, 0.3);
            const wrong = src.key === "yt" && v !== f.pick && f.pick !== "";
            if (src.key === "yt" && rejected) {
                drawShatter(canvas, s - COMPARE.reject, colX(c), rowY(r), v.slice(0, colW - 1), r);
                if (s > COMPARE.reject + 0.9) drawText(canvas, colX(c), rowY(r), "—", C.dim);
                return;
            }
            let color = C.text;
            if (wrong && s >= COMPARE.flag) color = mix(C.text, C.error, 0.6 + 0.4 * Math.sin(s * 10));
            drawText(canvas, colX(c), rowY(r), typed(v, p), color, { maxWidth: colW - 1 });
        });
    });

    // Compiled column: accepted values fly over from the Spotify column.
    fields.forEach((f, r) => {
        const y = rowY(r);
        if (f.pick) {
            const t0 = COMPARE.compile + r * 0.12;
            const q = progress(s, t0, 0.45);
            if (q <= 0) return;
            if (q < 1) {
                // A solid chip sliding along its own row, covering what it passes over.
                const e = easeOutCubic(q);
                const x = Math.round(lerp(colX(0), colX(3), e));
                const chip = ` ${f.pick.slice(0, colW - 3)} `;
                fillCells(canvas, x - 1, y, chip.length, 1, mix(C.focus, C.accent, 0.25));
                drawText(canvas, x - 1, y, chip, mix(WHITE, C.accent, e), { bold: true, solid: true });
                return;
            }
            const flash = 1 - smoothstep(0, 0.4, s - t0 - 0.45);
            if (flash > 0) fillCells(canvas, colX(3) - 1, y, colW, 1, mix(C.panel, C.accent, flash * 0.35));
            drawText(canvas, colX(3), y, f.pick, C.text, { maxWidth: colW - 1 });
            return;
        }
        if (!f.edit) return;
        // The empty field gets typed in by hand.
        const editing = s >= COMPARE.edit && s < COMPARE.done;
        if (editing) fillCells(canvas, colX(3) - 1, y, colW, 1, C.focus);
        const typedVal = typed(f.edit, progress(s, COMPARE.edit + 0.35, 0.8));
        if (s >= COMPARE.edit) drawText(canvas, colX(3), y, typedVal, C.text, { maxWidth: colW - 4 });
        else if (s > COMPARE.compile) drawText(canvas, colX(3), y, "—", C.dim);
        if (editing && Math.floor(s * 4) % 2 === 0) canvas.setGlyph(colX(3) + typedVal.length, y, "▌", C.accent);
        if (s >= COMPARE.edit + 1.3) {
            const x = colX(3) + Math.min(typedVal.length, colW - 10) + 2;
            drawText(canvas, x, y, "edited", fade(C.accent, 0.7));
        }
    });

    // Done: sparks drift up out of the compiled column.
    if (done) {
        const age = s - COMPARE.done;
        for (let k = 0; k < 14 && age < 1.2; k++) {
            const x = colX(3) + hash(k) * (colW - 2);
            const y = gy + gridH - 1 - age * (4 + hash(k + 9) * 8);
            canvas.setGlyph(x, y, k % 3 ? "·" : "+", fade(C.success, 1 - age / 1.2), true);
        }
    }
}

/** The characters of a rejected value falling apart under gravity. */
function drawShatter(canvas: Canvas, age: number, x0: number, y0: number, text: string, seed: number): void {
    if (age < 0 || age > 1) return;
    for (let j = 0; j < text.length; j++) {
        if (text[j] === " ") continue;
        const h = hash(seed * 97 + j);
        const delay = h * 0.15;
        const a = Math.max(0, age - delay);
        const x = x0 + j + (hash(seed * 31 + j) - 0.5) * 10 * a;
        const y = y0 - 2 * a + 14 * a * a;
        canvas.setGlyph(x, y, text[j], fade(C.error, 1 - age), true);
    }
}

// =====================================================================================
// Step 4 — download with YtDlp using the link discovered on YouTube
// =====================================================================================

export const DOWNLOAD = { duration: 7, boxes: 0.2, start: 1.0, end: 5.0 };

/** Download progress 0..1, with a fast start and a short stall like a real transfer. */
export function downloadProgress(s: number): number {
    const q = progress(s, DOWNLOAD.start, DOWNLOAD.end - DOWNLOAD.start);
    return clamp01(
        easeInOutSine(q) * 0.92 + Math.sin(q * Math.PI) * 0.04 + q * 0.08 - (q > 0.55 && q < 0.65 ? 0.02 : 0)
    );
}

export function drawDownloadScene(canvas: Canvas, s: number, l: TourLayout): void {
    const d = l.detail;
    const yt = provider("youtube");
    const dl = provider("ytdlp");
    const p = downloadProgress(s);
    const finished = s >= DOWNLOAD.end;

    const bw = Math.max(14, Math.min(32, Math.floor((d.w - 16) / 3)));
    const bh = 5;
    const y0 = d.y + Math.max(0, Math.floor((d.h - 10) / 3));
    const totalW = bw * 3 + 16;
    const x0 = Math.round(d.x + (d.w - totalW) / 2);
    const boxes = [x0, x0 + bw + 8, x0 + 2 * bw + 16];

    const pop = (k: number) => easeOutBack(progress(s, DOWNLOAD.boxes + k * 0.15, 0.35));

    // Data streams between the boxes, flowing left to right.
    if (s >= DOWNLOAD.start - 0.1 && !finished) {
        const y = y0 + 2;
        const lanes = [
            [boxes[0] + bw, boxes[1] - 1],
            [boxes[1] + bw, boxes[2] - 1],
        ];
        lanes.forEach(([a, b], lane) => {
            const len = b - a;
            for (let x = a; x < b; x++) canvas.setGlyph(x, y, "─", C.dim);
            for (let k = 0; k < 4; k++) {
                const q = (s * 1.6 + k / 4 + lane * 0.13) % 1;
                const ch = "01▪•"[Math.floor(hash(k + lane * 7 + Math.floor(s * 8)) * 4)];
                canvas.setGlyph(a + q * len, y, ch, mix(lane ? dl.bright : yt.color, C.accent, q), false, true);
            }
        });
    }

    // Source: the link discovered in step 2.
    if (pop(0) > 0) {
        drawPanel(canvas, boxes[0], y0, Math.max(4, Math.round(bw * pop(0))), bh, {
            border: yt.color,
            fill: C.panel,
            title: yt.label,
            titleColor: yt.bright,
        });
        if (pop(0) > 0.95) {
            drawText(canvas, boxes[0] + 2, y0 + 1, DEMO.youtubeShort, C.text, { maxWidth: bw - 4 });
            drawText(canvas, boxes[0] + 2, y0 + 3, "✓ discovered", C.success, { maxWidth: bw - 4 });
        }
    }

    // The download provider at work.
    if (pop(1) > 0) {
        const busy = s >= DOWNLOAD.start && !finished;
        drawPanel(canvas, boxes[1], y0, Math.max(4, Math.round(bw * pop(1))), bh, {
            border: busy ? mix(dl.color, WHITE, 0.25 + 0.25 * Math.sin(s * 8)) : dl.color,
            fill: C.panel,
            title: dl.label,
            titleColor: dl.bright,
        });
        if (pop(1) > 0.95) {
            const status = finished ? "✓ done" : busy ? `${spinner(s)} extracting audio` : "ready";
            drawText(canvas, boxes[1] + 2, y0 + 1, status, finished ? C.success : C.text, { maxWidth: bw - 4 });
            drawText(canvas, boxes[1] + 2, y0 + 3, "best audio · m4a", C.muted, { maxWidth: bw - 4 });
        }
    }

    // The output file, its waveform written in as bytes arrive.
    if (pop(2) > 0) {
        const doneFlash = finished ? 1 - smoothstep(0, 0.6, s - DOWNLOAD.end) : 0;
        drawPanel(canvas, boxes[2], y0, Math.max(4, Math.round(bw * pop(2))), bh, {
            border: finished ? C.success : C.border,
            fill: mix(C.panel, C.success, doneFlash * 0.3),
            title: "output",
            titleColor: finished ? C.success : C.border,
        });
        if (pop(2) > 0.95) {
            drawText(canvas, boxes[2] + 2, y0 + 1, DEMO.fileName, C.text, { maxWidth: bw - 4 });
            const bars = Math.floor((bw - 4) * p);
            for (let k = 0; k < bars; k++) {
                const h = 0.25 + 0.75 * Math.abs(Math.sin(k * 0.7) * hash(k + 3));
                canvas.setGlyph(boxes[2] + 2 + k, y0 + 3, BARS[Math.round(h * 7)], hsv(0.08 + k / 60, 0.7, 1));
            }
        }
    }

    // Progress bar + transfer stats.
    const by = y0 + bh + 2;
    const barW = Math.min(d.w - 8, totalW);
    const bx = Math.round(d.x + (d.w - barW) / 2);
    if (s >= DOWNLOAD.start - 0.3) {
        const filled = Math.floor(barW * p);
        for (let k = 0; k < barW; k++) {
            if (k < filled) {
                const q = k / barW;
                let c = q < 0.5 ? mix(yt.color, C.accent, q * 2) : mix(C.accent, C.success, (q - 0.5) * 2);
                // A bright shimmer travelling along the filled part.
                const band = Math.max(0, 1 - Math.abs(k - ((s * 40) % (filled + 20)) + 10) / 6);
                c = mix(c, WHITE, band * 0.5);
                fillCells(
                    canvas,
                    bx + k,
                    by,
                    1,
                    1,
                    finished ? mix(c, C.success, smoothstep(0, 0.5, s - DOWNLOAD.end)) : c
                );
            } else {
                fillCells(canvas, bx + k, by, 1, 1, C.rowHi);
            }
        }
        const pct = Math.round(p * 100);
        const mib = (DEMO.sizeMiB * p).toFixed(1);
        const speed = finished ? "" : `   ${(3.4 + Math.sin(s * 3) * 0.9).toFixed(1)} MiB/s`;
        const label = finished
            ? `✓ Downloaded ${DEMO.sizeMiB} MiB`
            : `${spinner(s)} Downloading  ${String(pct).padStart(3)}%   ${mib} / ${DEMO.sizeMiB} MiB${speed}`;
        drawText(canvas, bx, by + 2, label, finished ? C.success : C.text, { bold: finished, maxWidth: barW });
    }

    if (finished) drawSparkBurst(canvas, s - DOWNLOAD.end, boxes[2] + bw / 2, y0 + 2, C.success, 4);
}

const BARS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

function drawSparkBurst(canvas: Canvas, age: number, cx: number, cy: number, color: RGB, seed: number): void {
    if (age < 0 || age > 1) return;
    for (let k = 0; k < 18; k++) {
        const a = hash(seed * 100 + k) * Math.PI * 2;
        const r = (1 - Math.exp(-4 * age)) * (8 + hash(seed * 100 + k + 50) * 14);
        canvas.setGlyph(
            cx + Math.cos(a) * r,
            cy + Math.sin(a) * r * 0.5,
            k % 3 ? "•" : "+",
            fade(color, 1 - age),
            true
        );
    }
}

// =====================================================================================
// Step 5 — preview: playback with spectrum, album art and file tags
// =====================================================================================

export const PREVIEW = { duration: 7.5, open: 0.1, play: 1.1, bpm: 118 };

export function drawPreviewScene(canvas: Canvas, s: number, l: TourLayout): void {
    const d = l.detail;
    const pw = Math.min(d.w - 2, 112);
    const ph = Math.min(d.h - 1, 15);
    const px = Math.round(d.x + (d.w - pw) / 2);
    const py = d.y + Math.max(0, Math.floor((d.h - ph) / 3));
    const open = easeOutCubic(progress(s, PREVIEW.open, 0.4));
    if (open <= 0) return;
    drawPanel(canvas, px, py, Math.max(4, Math.round(pw * open)), ph, {
        border: C.border,
        fill: C.panel,
        title: "Preview",
        titleColor: C.accent,
    });
    if (open < 1) return;

    const playing = s >= PREVIEW.play;
    const beatT = playing ? (s - PREVIEW.play) * (PREVIEW.bpm / 60) : 0;
    const kick = playing ? Math.exp(-6 * (beatT % 1)) : 0;

    // Album art, pulsing with the kick.
    const artRows = Math.max(3, Math.min(ph - 2, 11));
    const art: Rect = { x: px + 2, y: py + 1, w: artRows * 2, h: artRows };
    drawAlbumArt(canvas, art, s, kick);

    // File tags.
    const tx = art.x + art.w + 3;
    const tw = px + pw - tx - 2;
    const tags: [string, string][] = [
        ["Title", DEMO.title],
        ["Artist", DEMO.artist],
        ["Album", DEMO.album],
        ["Year", DEMO.year],
        ["Genre", DEMO.genre],
        ["Format", "AAC 256 kbps · 44.1 kHz"],
    ];
    const tagRows = Math.max(1, Math.min(tags.length, ph - 6));
    tags.slice(0, tagRows).forEach(([k, v], i) => {
        const p = progress(s, 0.4 + i * 0.08, 0.3);
        if (p <= 0) return;
        drawText(canvas, tx, py + 1 + i, k, C.muted);
        drawText(canvas, tx + 9, py + 1 + i, typed(v, p), C.text, { maxWidth: tw - 9 });
    });

    // Spectrum: stacked rows of bars (8 levels per row) filling the space under the tags.
    const specRows = Math.max(1, Math.min(4, ph - tagRows - 5));
    const specBottom = py + ph - 3;
    const bars = Math.max(4, tw);
    for (let k = 0; k < bars; k++) {
        const f = k / bars;
        const base = Math.sin(f * Math.PI) * 0.6 + (1 - f) * 0.3;
        const flicker = hash(k * 13 + Math.floor(s * 14));
        const level = playing ? clamp01(base * (0.55 + 0.6 * kick) + flicker * 0.35) : 0.03;
        let units = Math.round(level * specRows * 8);
        const c = hsv(0.83 - f * 0.35 + s * 0.02, 0.75, 0.95);
        for (let row = 0; row < specRows && units > 0; row++) {
            canvas.setGlyph(tx + k, specBottom - row, units >= 8 ? "█" : BARS[units - 1], scale(c, 1 - row * 0.12));
            units -= 8;
        }
    }

    // Transport: play state, playhead, time.
    const elapsed = playing ? 42 + (s - PREVIEW.play) : 42;
    const total = 221;
    const time = (secs: number) => `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, "0")}`;
    const ty = py + ph - 2;
    drawText(canvas, tx, ty, playing ? "►" : "■", playing ? C.success : C.muted, { bold: true });
    const left = time(elapsed);
    const right = time(total);
    const trackX = tx + 2 + left.length + 1;
    const trackW = Math.max(4, tw - left.length - right.length - 5);
    drawText(canvas, tx + 2, ty, left, C.text);
    const head = Math.floor((elapsed / total) * trackW);
    for (let k = 0; k < trackW; k++) {
        canvas.setGlyph(trackX + k, ty, k < head ? "━" : "─", k < head ? C.accent : C.dim);
    }
    canvas.setGlyph(trackX + head, ty, "●", C.accent, false, true);
    drawText(canvas, trackX + trackW + 1, ty, right, C.muted);

    // Notes floating up out of the art.
    if (playing) {
        for (let k = 0; k < 6; k++) {
            const period = 2.2;
            const age = (s - PREVIEW.play + k * (period / 6)) % period;
            const x =
                art.x +
                art.w * (0.2 + 0.6 * hash(k + Math.floor((s - PREVIEW.play) / period) * 7)) +
                Math.sin(age * 4 + k) * 1.5;
            // Rise through the art only, so notes never cover the rest of the UI.
            const y = art.y + art.h * 0.9 - (age / period) * art.h * 0.85;
            canvas.setGlyph(x, y, k % 2 ? "♪" : "♫", fade(hsv(0.85 - k * 0.1, 0.5, 1), 1 - age / period), false, true);
        }
    }
}

/** A synthwave cover: striped sun over a scrolling perspective grid. */
function drawAlbumArt(canvas: Canvas, r: Rect, s: number, kick: number): void {
    const w = r.w;
    const h = r.h * 2;
    const horizon = 0.6;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const u = (x + 0.5) / w;
            const v = (y + 0.5) / h;
            let c: RGB;
            if (v < horizon) {
                c = mix(hex("#1B0636"), hex("#FF2E88"), Math.pow(v / horizon, 1.6));
                const du = u - 0.5;
                const dv = (v - 0.48) * 1.0;
                const sunR = 0.27 + kick * 0.015;
                const inSun = du * du + dv * dv < sunR * sunR;
                const stripe = v > 0.36 && Math.floor(v * h) % 3 === 0;
                if (inSun && !stripe) c = mix(hex("#FFE45C"), hex("#FF5E3A"), clamp01((v - 0.22) / 0.38));
            } else {
                // Perspective grid: rows scroll towards the viewer, columns fan out from
                // the vanishing point.
                const depth = (v - horizon) / (1 - horizon);
                c = hex("#12021F");
                const rowPhase = (((depth * depth * 3 - s * 0.8) % 1) + 1) % 1;
                const onRow = rowPhase * h * (1 - horizon) < 1.1 / (0.4 + depth) || depth < 0.04;
                let onCol = false;
                for (let k = -4; k <= 4 && !onCol; k++) {
                    const lx = 0.5 + k * 0.12 * (0.2 + depth * 1.8);
                    if (Math.abs(u - lx) * w < 0.55) onCol = true;
                }
                if (onRow || onCol) c = mix(hex("#7A1FA2"), hex("#FF2BD6"), depth);
            }
            canvas.setPixel(r.x + x, r.y * 2 + y, scale(c, 0.85 + kick * 0.15), UI_Z + 1);
        }
    }
}

// =====================================================================================
// Step 6 — save the file to disk
// =====================================================================================

export const SAVE = { duration: 6.5, path: 0.4, fly: 2.2, land: 3.0 };

export function drawSaveScene(canvas: Canvas, s: number, l: TourLayout): void {
    const d = l.detail;
    const midY = d.y + Math.floor(Math.min(d.h, 16) / 2);
    const landed = s >= SAVE.land;

    // The destination, built segment by segment like a save path.
    const fx = Math.round(d.x + d.w * 0.62);
    const folderW = 18;
    const folderBottom = (midY + 2) * 2;
    // The path tree sits left of the folder, above the file card's row.
    const treeW = 3 * (DEMO.folders.length - 1) + Math.max(...DEMO.folders.map((f) => f.length + 1));
    const treeX = Math.max(d.x, fx - 3 - treeW);
    const treeY = Math.max(d.y, midY - 1 - DEMO.folders.length);
    DEMO.folders.forEach((name, i) => {
        const p = progress(s, SAVE.path + i * 0.35, 0.3);
        if (p <= 0) return;
        const x = treeX + i * 3;
        if (i > 0) drawText(canvas, x - 3, treeY + i, "└─", C.dim);
        const last = i === DEMO.folders.length - 1;
        drawText(canvas, x, treeY + i, typed(name + "/", p), last ? C.accent : C.muted, { bold: last });
    });

    // A chunky pixel folder that gulps the file when it lands.
    const appear = easeOutBack(progress(s, SAVE.path, 0.5));
    if (appear > 0) {
        const gulp = landed ? wobble(s - SAVE.land, 2.5, 4) : 0;
        drawFolder(
            canvas,
            fx + folderW / 2,
            folderBottom,
            folderW * appear * (1 + gulp * 0.15),
            1 - gulp * 0.15,
            landed ? 1 - smoothstep(0, 0.8, s - SAVE.land) : 0
        );
    }

    // The file card flies in an arc into the folder, shrinking as it goes.
    const label = `♪ ${DEMO.fileName}`;
    const startX = d.x + 4;
    const q = progress(s, SAVE.fly, SAVE.land - SAVE.fly);
    if (!landed) {
        const e = easeInOutSine(q);
        const x = lerp(startX, fx + folderW / 2 - 3, e);
        const y = midY - Math.sin(e * Math.PI) * 4 + e * 1;
        const width = Math.max(3, Math.round(lerp(label.length + 4, 4, e * e)));
        const cardIn = easeOutBack(progress(s, 0.2, 0.4));
        if (cardIn > 0) {
            fillCells(canvas, x - 1, y, width, 1, mix(C.focus, C.accent, 0.15));
            drawText(canvas, x + 1, y, label, mix(C.text, C.accent, e), { bold: true, maxWidth: width - 2 });
            if (q > 0) {
                for (let k = 1; k < 7; k++) {
                    const ek = easeInOutSine(clamp01(q - k * 0.04));
                    const tx = lerp(startX, fx + folderW / 2 - 3, ek);
                    const ty = midY - Math.sin(ek * Math.PI) * 4 + ek;
                    canvas.setGlyph(tx, ty, k < 3 ? "•" : "·", fade(C.accent, 1 - k / 7), true);
                }
            }
        }
    }

    if (landed) {
        const full = `✓ Saved to ${DEMO.folders.join("/")}/`;
        drawText(
            canvas,
            Math.round(d.x + (d.w - full.length) / 2),
            Math.min(d.y + d.h - 1, midY + 4),
            typed(full, progress(s, SAVE.land + 0.2, 0.6)),
            C.success,
            { bold: true }
        );
        drawConfetti(canvas, s - SAVE.land, fx + folderW / 2, midY);
    }
}

/** Folder icon, `w` pixels wide, anchored at its bottom centre. `flash` lights it up. */
function drawFolder(canvas: Canvas, cx: number, bottom: number, w: number, squashY: number, flash: number): void {
    const h = Math.round(w * 0.62 * squashY);
    const x0 = Math.round(cx - w / 2);
    const y0 = Math.round(bottom - h);
    const back = mix(hex("#C98A1E"), WHITE, flash * 0.5);
    const front = mix(hex("#FFC94A"), WHITE, flash * 0.6);
    const tabW = Math.round(w * 0.4);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < Math.round(w); x++) {
            const v = y / h;
            let c: RGB | null = null;
            if (v < 0.15) {
                if (x < tabW) c = back;
            } else if (v < 0.35) c = back;
            else c = mix(front, hex("#E39B22"), (v - 0.35) / 0.65);
            if (c) canvas.setPixel(x0 + x, y0 + y, c, UI_Z + 1);
        }
    }
}

const CONFETTI = ["▪", "•", "◦", "*", "+", "♦"];

/** A burst of rainbow confetti that rises, then rains down across the screen. */
function drawConfetti(canvas: Canvas, age: number, cx: number, cy: number): void {
    if (age < 0 || age > 3) return;
    for (let k = 0; k < 70; k++) {
        const a = -Math.PI / 2 + (hash(k * 3) - 0.5) * Math.PI * 1.4;
        const v = 18 + hash(k * 3 + 1) * 40;
        const x = cx + Math.cos(a) * v * age * 0.9 + Math.sin(age * 5 + k) * 1.2;
        const y = cy + Math.sin(a) * v * age * 0.35 + 9 * age * age;
        const ch = CONFETTI[Math.floor(hash(k + Math.floor(age * 10)) * CONFETTI.length)];
        // "behind": confetti only fills empty space, never covering text or shapes.
        canvas.setGlyph(x, y, ch, fade(hsv(hash(k * 7), 0.7, 1), 1 - smoothstep(2, 3, age)), true);
    }
}
