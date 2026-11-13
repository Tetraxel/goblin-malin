/**
 * Compares two renders of the same sound (see render-intro-mix.ts) without listening: how far apart they are in
 * time, and how close in level and content.
 *
 *   node scripts/compare-audio.mjs reference.wav candidate.wav [--window 0.5]
 *
 * Reports the shift between them (in samples, found by cross-correlation: 0 means every sound starts exactly
 * where it did), the signal-to-difference ratio of the whole file and of each window, and the loudest window
 * differences. A lossy copy of a sound sits around 20-35 dB; a missing or misplaced sound shows as a window
 * near 0 dB or below. Needs ffmpeg on the PATH.
 */
import { spawnSync } from "node:child_process";

const [, , referenceFile, candidateFile, ...rest] = process.argv;
if (!referenceFile || !candidateFile) {
    process.stderr.write("Usage: node scripts/compare-audio.mjs <reference.wav> <candidate.wav> [--window 0.5]\n");
    process.exit(1);
}
const windowFlag = rest.indexOf("--window");
const windowSeconds = windowFlag >= 0 ? Number(rest[windowFlag + 1]) : 0.5;
const RATE = 48000;

/** Mono float samples at 48 kHz. */
function decode(file) {
    const result = spawnSync(
        "ffmpeg",
        ["-v", "error", "-i", file, "-ac", "1", "-ar", String(RATE), "-f", "f32le", "-"],
        { maxBuffer: 1 << 30 }
    );
    if (result.status !== 0) throw new Error(`ffmpeg failed on ${file}: ${result.stderr}`);
    const b = result.stdout;
    return new Float32Array(b.buffer, b.byteOffset, Math.floor(b.byteLength / 4));
}

const reference = decode(referenceFile);
const candidate = decode(candidateFile);
const n = Math.min(reference.length, candidate.length);

/** Best shift in [-maxLag, maxLag]: positive means the candidate is late. Uses the loudest second only. */
function bestLag(maxLag = 2000) {
    const win = RATE;
    let start = 0;
    let best = -1;
    for (let s = 0; s + win < n; s += win / 2) {
        let e = 0;
        for (let i = s; i < s + win; i++) e += reference[i] * reference[i];
        if (e > best) {
            best = e;
            start = s;
        }
    }
    let bestShift = 0;
    let bestScore = -Infinity;
    for (let lag = -maxLag; lag <= maxLag; lag++) {
        let dot = 0;
        for (let i = start; i < start + win; i++) {
            const j = i + lag;
            if (j >= 0 && j < candidate.length) dot += reference[i] * candidate[j];
        }
        if (dot > bestScore) {
            bestScore = dot;
            bestShift = lag;
        }
    }
    return bestShift;
}

const db = (x) => (x <= 0 ? -Infinity : 10 * Math.log10(x));
const lag = bestLag();

const win = Math.round(windowSeconds * RATE);
const rows = [];
let totalSignal = 0;
let totalDiff = 0;
for (let s = 0; s + win <= n; s += win) {
    let signal = 0;
    let diff = 0;
    for (let i = s; i < s + win; i++) {
        const c = candidate[i + lag] ?? 0;
        signal += reference[i] * reference[i];
        diff += (reference[i] - c) ** 2;
    }
    totalSignal += signal;
    totalDiff += diff;
    rows.push({ at: s / RATE, level: db(signal / win), ratio: db(signal) - db(diff) });
}

/** The window's signal-to-difference after the best local shift (within +-LOCAL_LAG samples of the global one). */
const LOCAL_LAG = 600;
function alignedRatio(at) {
    const start = Math.round(at * RATE);
    let signal = 0;
    for (let i = start; i < start + win; i++) signal += reference[i] * reference[i];
    let best = { ratio: -Infinity, lag: 0 };
    for (let l = lag - LOCAL_LAG; l <= lag + LOCAL_LAG; l++) {
        let dot = 0;
        let cand = 0;
        for (let i = start; i < start + win; i++) {
            const c = candidate[i + l] ?? 0;
            dot += reference[i] * c;
            cand += c * c;
        }
        // Residual after the best gain: ||r||^2 - (r.c)^2 / ||c||^2 (a level change is not a different sound).
        const diff = cand > 0 ? signal - (dot * dot) / cand : signal;
        const ratio = db(signal) - db(Math.max(diff, 1e-20));
        if (ratio > best.ratio) best = { ratio, lag: l };
    }
    return best;
}

const length = (a) => (a.length / RATE).toFixed(3);
process.stdout.write(`reference ${length(reference)}s, candidate ${length(candidate)}s\n`);
process.stdout.write(`shift of the candidate: ${lag} samples (${((lag / RATE) * 1000).toFixed(2)} ms)\n`);
process.stdout.write(`overall signal-to-difference: ${(db(totalSignal) - db(totalDiff)).toFixed(1)} dB\n`);

// Windows that are audible (above -60 dBFS) sorted by how far the candidate is from the reference.
const audible = rows.filter((r) => r.level > -60).sort((a, b) => a.ratio - b.ratio);
process.stdout.write(`${audible.length} audible windows of ${windowSeconds}s; the 8 worst:\n`);
for (const r of audible.slice(0, 8)) {
    // A time-stretch (atempo) can place its overlaps a few samples differently for a lossy input: the sound is the
    // same but not sample for sample. Re-align this window alone before judging it.
    const local = alignedRatio(r.at);
    process.stdout.write(
        `  ${r.at.toFixed(1).padStart(6)}s  level ${r.level.toFixed(1)} dB  signal/diff ${r.ratio.toFixed(1)} dB` +
            `  (aligned: ${local.ratio.toFixed(1)} dB at ${local.lag} samples)\n`
    );
}
const quiet = rows.filter((r) => r.level <= -60).length;
process.stdout.write(`${quiet} windows are silent in the reference\n`);
