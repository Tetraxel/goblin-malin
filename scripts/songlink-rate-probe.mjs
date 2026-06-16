// @ts-nocheck
/**
 * Song.link rate-limit probe.
 *
 * Empirically characterizes the song.link API rate limit. The official docs say "10 requests
 * per minute" but don't say whether a 429 (rejected) request still counts against the window.
 * This script finds out by running over ~10 minutes in phases and logging every request, then
 * analyzing the timeline.
 *
 * Phases:
 *   1. BURST1   — fire requests back-to-back until the first 429 → measures burst capacity.
 *   2. FAST     — keep sending ABOVE the limit (default every 4s = 15/min) for a few minutes.
 *                 This is the discriminator:
 *                   • if 429s do NOT count, successes reappear ~1 window after the burst (only
 *                     successful requests age out of the window), so we see intermittent 200s;
 *                   • if 429s DO count, every rejection refills the window and we stay locked
 *                     out (≈100% 429 across multiple windows).
 *   3. COOLDOWN — send nothing for ~75s so the window fully clears.
 *   4. BURST2   — burst again to confirm capacity was restored and reproduce the burst size.
 *   5. SLOW     — probe at ~10/min (every 6s) for the remainder to observe steady state.
 *
 * Output: pretty console log + logs/songlink-rate-probe-<ts>.log + .jsonl (raw events), and a
 * final SUMMARY with the inferred limit, window, and 429-counting verdict.
 *
 * Run:   yarn probe:songlink
 * Tune:  PROBE_TOTAL_MS, PROBE_FAST_INTERVAL_MS, PROBE_FAST_MS, PROBE_COOLDOWN_MS,
 *        PROBE_SLOW_INTERVAL_MS, PROBE_BURST_MAX, PROBE_COUNTRY  (env vars, all optional)
 * Quick smoke test: PROBE_TOTAL_MS=20000 PROBE_FAST_MS=8000 PROBE_COOLDOWN_MS=3000 yarn probe:songlink
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ── Config (all overridable via env) ─────────────────────────────────────────
const API = "https://api.song.link/v1-alpha.1/links";
const WINDOW_MS = 60_000; // assumed rate window, used only for the per-minute analysis
const TOTAL_MS = num("PROBE_TOTAL_MS", 10 * 60 * 1000);
const BURST_MAX = num("PROBE_BURST_MAX", 30); // safety cap on a single burst
const FAST_INTERVAL_MS = num("PROBE_FAST_INTERVAL_MS", 4_000); // 15/min — above the 10/min doc limit
const FAST_PHASE_MS = num("PROBE_FAST_MS", 4 * 60 * 1000);
const COOLDOWN_MS = num("PROBE_COOLDOWN_MS", 75_000);
const SLOW_INTERVAL_MS = num("PROBE_SLOW_INTERVAL_MS", 20_000); // 3/min
// Recovery / settle: optional initial total silence, then probe with GROWING gaps until a 200.
// Sparse + growing gaps avoid keeping a "penalty box" block alive (continuous polling does).
const PRE_SILENCE_MS = num("PROBE_PRE_SILENCE_MS", 0); // total silence before probing at all
const RECOVER_GAPS_MS = (process.env.PROBE_RECOVER_GAPS ?? "30,60,90,120,180,240")
    .split(",")
    .map((s) => Math.round(Number(s) * 1000))
    .filter((n) => Number.isFinite(n) && n > 0);
const USER_COUNTRY = process.env.PROBE_COUNTRY ?? "FR";
// Mode: "full" = burst/fast/cooldown/slow characterization; "steady" = just pace at a fixed
// interval to test whether that rate is sustainable (no 429s) over the whole duration.
const MODE = (process.env.PROBE_MODE ?? "full").toLowerCase();
const STEADY_INTERVAL_MS = num("PROBE_STEADY_INTERVAL_MS", 10_000); // default 1 req / 10s = 6/min
// Run indefinitely (until Ctrl+C) unless an explicit PROBE_TOTAL_MS is set.
const INFINITE = !process.env.PROBE_TOTAL_MS;

function num(name, def) {
    const v = Number(process.env[name]);
    return Number.isFinite(v) && v > 0 ? v : def;
}

// ── URL pool (real tracks, so we get real 200s) ──────────────────────────────
const BUILTIN_URLS = [
    "https://open.spotify.com/track/4v7kKFlEDmpVToHOICsXaM",
    "https://open.spotify.com/track/5b3n32izrzbkTMC16FZ83r",
    "https://open.spotify.com/track/4qJzVJ3QzvYq6PrahkUlAI",
    "https://open.spotify.com/track/0U7HhD9Eqx5bk8HmRQwN5u",
    "https://open.spotify.com/track/6FOlC4eNFNkQYalK0WfGHa",
    "https://open.spotify.com/track/6I9VzXrHxO9rA9A5euc8Ak",
    "https://open.spotify.com/track/2jrzCpf7Ie750KCENF6yDo",
    "https://open.spotify.com/track/2zflx0uUTi6e8nw25XYvMo",
];

function loadUrls() {
    for (const f of ["inputs.txt", "urls.txt"]) {
        const p = path.join(ROOT, f);
        if (!fs.existsSync(p)) continue;
        const urls = fs
            .readFileSync(p, "utf8")
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith("#"))
            .map((l) => l.split(/\s+/)[0]) // strip trailing annotations like "  <----"
            .filter((l) => /^https?:\/\//.test(l));
        if (urls.length) return { urls, source: f };
    }
    return { urls: BUILTIN_URLS, source: "builtin" };
}

const { urls: URL_POOL, source: URL_SOURCE } = loadUrls();

// ── Logging ──────────────────────────────────────────────────────────────────
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const logDir = path.join(ROOT, "logs");
fs.mkdirSync(logDir, { recursive: true });
const txtPath = path.join(logDir, `songlink-rate-probe-${stamp}.log`);
const jsonlPath = path.join(logDir, `songlink-rate-probe-${stamp}.jsonl`);
const txtStream = fs.createWriteStream(txtPath, { flags: "a" });
const jsonlStream = fs.createWriteStream(jsonlPath, { flags: "a" });

const t0 = Date.now(); // for elapsed-time display in logs
let deadline = INFINITE ? Infinity : t0 + TOTAL_MS; // experiment deadline; reset after recovery
const events = [];
let reqCounter = 0;
let recoveryInfo = null; // set by runRecover: how long until the IP cleared
let dumpedHeadersFor = new Set(); // dump full headers once per status

function fmtElapsed(ms) {
    const s = Math.floor(ms / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
function line(msg) {
    const out = `[${fmtElapsed(Date.now() - t0)}] ${msg}`;
    // eslint-disable-next-line no-console
    console.log(out);
    txtStream.write(out + "\n");
}
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
function pickUrl() {
    return URL_POOL[reqCounter % URL_POOL.length];
}
function timeLeft() {
    return deadline - Date.now();
}

// ── A single probe request ───────────────────────────────────────────────────
async function probe(phase) {
    const i = ++reqCounter;
    const url = pickUrl();
    const qs = new URLSearchParams({ url, userCountry: USER_COUNTRY, songIfSingle: "true" });
    const full = `${API}?${qs}`;
    const startedAt = Date.now();

    let status = 0;
    let ok = false;
    let retryAfter = null;
    const rlHeaders = {};
    let errMsg = null;
    let bodyHint = null;

    try {
        const res = await fetch(full);
        status = res.status;
        ok = res.ok;
        retryAfter = res.headers.get("retry-after");
        for (const [k, v] of res.headers) {
            if (/rate|retry|limit|remaining|reset/i.test(k)) rlHeaders[k] = v;
        }
        const body = await res.text(); // always drain the body to free the socket
        if (status === 429) bodyHint = body.slice(0, 200);

        // Dump the full header set once per distinct status, for the record.
        if (!dumpedHeadersFor.has(status)) {
            dumpedHeadersFor.add(status);
            const all = Object.fromEntries(res.headers);
            line(`  ↳ full headers for first status=${status}: ${JSON.stringify(all)}`);
        }
    } catch (e) {
        errMsg = String(e?.message ?? e);
    }

    const latencyMs = Date.now() - startedAt;
    const ev = { i, phase, t: startedAt, status, ok, retryAfter, latencyMs, rlHeaders, errMsg };
    events.push(ev);
    jsonlStream.write(JSON.stringify({ ...ev, iso: new Date(startedAt).toISOString(), url }) + "\n");

    const tag = errMsg ? `ERR ${errMsg}` : `status=${status}${ok ? " OK" : ""}`;
    const extra = [
        retryAfter ? `retry-after=${retryAfter}` : null,
        Object.keys(rlHeaders).length ? `rl=${JSON.stringify(rlHeaders)}` : null,
        bodyHint ? `body="${bodyHint.replace(/\s+/g, " ")}"` : null,
    ]
        .filter(Boolean)
        .join(" ");
    line(`#${String(i).padStart(3)} ${phase.padEnd(7)} ${tag} ${latencyMs}ms ${extra}`.trimEnd());
    return ev;
}

// ── Phase runners ─────────────────────────────────────────────────────────────
/**
 * Recover to a clean window and, as a side effect, measure how long that takes. Optionally waits
 * PRE_SILENCE_MS in total silence first, then probes with GROWING gaps (RECOVER_GAPS_MS) until a
 * 200. Sparse, growing gaps matter: if the API uses a "penalty box" that refreshes on every hit,
 * continuous polling never recovers, whereas a gap that eventually exceeds the block does.
 * Returns the recovery info (or null if never recovered).
 */
async function runRecover() {
    if (PRE_SILENCE_MS > 0) {
        line(`── PRE-SILENCE: sending nothing for ${Math.round(PRE_SILENCE_MS / 1000)}s ──`);
        await sleep(PRE_SILENCE_MS);
    }
    line(`── RECOVER: probing with growing gaps (${RECOVER_GAPS_MS.map((g) => g / 1000).join(",")}s) until a 200 ──`);
    const startedAt = Date.now();
    for (let k = 0; ; k++) {
        const ev = await probe("RECOVER");
        if (ev.ok) {
            const secs = ((Date.now() - startedAt) / 1000).toFixed(0);
            line(`RECOVER: got first 200 after ${k} gap(s) / ~${secs}s of recovery probing.`);
            return { recoveredAfterMs: Date.now() - startedAt, gaps: k };
        }
        if (k >= RECOVER_GAPS_MS.length) {
            line(`RECOVER: still 429 after all ${RECOVER_GAPS_MS.length} gaps — giving up; results inconclusive.`);
            return null;
        }
        const gap = RECOVER_GAPS_MS[k];
        line(`RECOVER: still 429; staying silent ${gap / 1000}s, then retrying…`);
        await sleep(gap);
    }
}

async function runBurstUntil429(phase) {
    line(`── ${phase}: bursting until first 429 (max ${BURST_MAX}) ──`);
    let successes = 0;
    for (let n = 0; n < BURST_MAX && timeLeft() > 0; n++) {
        const ev = await probe(phase);
        if (ev.status === 429) {
            line(`${phase}: first 429 after ${successes} success(es).`);
            return { successes, hit429: true };
        }
        if (ev.ok) successes++;
    }
    line(`${phase}: no 429 within ${BURST_MAX} requests (${successes} success(es)).`);
    return { successes, hit429: false };
}

async function runInterval(phase, intervalMs, durationMs) {
    const budget = Math.min(durationMs, timeLeft());
    const until = Date.now() + budget; // Infinity when running indefinitely
    const durLabel = Number.isFinite(budget) ? `${Math.round(budget / 1000)}s` : "∞ (until Ctrl+C)";
    line(`── ${phase}: 1 request every ${intervalMs / 1000}s for ${durLabel} ──`);
    while (Date.now() < until && timeLeft() > 0) {
        const ev = await probe(phase);
        const wait = Math.max(0, intervalMs - ev.latencyMs);
        if (Date.now() + wait >= until) break;
        await sleep(wait);
    }
}

// ── Analysis ──────────────────────────────────────────────────────────────────
function maxInRollingWindow(predicate) {
    const ts = events.filter(predicate).map((e) => e.t);
    let max = 0;
    for (let i = 0; i < ts.length; i++) {
        let c = 0;
        for (let j = i; j < ts.length && ts[j] - ts[i] < WINDOW_MS; j++) c++;
        if (c > max) max = c;
    }
    return max;
}

function analyze() {
    const total = events.length;
    const ok = events.filter((e) => e.ok).length;
    const r429 = events.filter((e) => e.status === 429).length;
    const errs = events.filter((e) => e.errMsg).length;
    const other = total - ok - r429 - errs;

    const fast = events.filter((e) => e.phase === "FAST");
    const fast200 = fast.filter((e) => e.ok).length;
    const fast429 = fast.filter((e) => e.status === 429).length;

    const burst1 = events.find((e) => e.phase === "BURST1" && e.status === 429);
    const lastBurst1Success = [...events].reverse().find((e) => e.phase === "BURST1" && e.ok);
    const firstFastSuccess = fast.find((e) => e.ok);
    const recoveryMs = lastBurst1Success && firstFastSuccess ? firstFastSuccess.t - lastBurst1Success.t : null;

    const effLimit = maxInRollingWindow((e) => e.ok); // max successes in any 60s
    const reqRate = maxInRollingWindow(() => true); // max requests in any 60s

    const retryAfters = [...new Set(events.map((e) => e.retryAfter).filter(Boolean))];
    const rlHeaderKeys = [...new Set(events.flatMap((e) => Object.keys(e.rlHeaders)))];

    // Steady-mode stats.
    const steady = events.filter((e) => e.phase === "STEADY");
    const s200 = steady.filter((e) => e.ok).length;
    const s429 = steady.filter((e) => e.status === 429).length;
    const firstS429 = steady.find((e) => e.status === 429);
    const firstS429At = firstS429 ? ((firstS429.t - steady[0].t) / 1000).toFixed(0) : null;

    // Verdict depends on mode.
    let verdict;
    if (MODE === "steady") {
        const perMin = (60000 / STEADY_INTERVAL_MS).toFixed(1);
        if (steady.length === 0) {
            verdict = "INCONCLUSIVE — STEADY phase did not run.";
        } else if (s429 === 0) {
            verdict = `SUSTAINED ✅ — sent ${s200} requests at ${perMin}/min with ZERO 429s. This pace appears safe.`;
        } else {
            verdict = `NOT SUSTAINABLE ❌ — at ${perMin}/min the first 429 hit after ${s200 ? `${countSuccessesInPhase("STEADY")} successes` : "no successes"} (~${firstS429At}s in), then ${s429} total 429s. This pace eventually trips the block.`;
        }
    } else if (ok === 0) {
        verdict =
            "INCONCLUSIVE — zero successful requests the entire run; the IP was already rate-limited and never cleared (the SETTLE step couldn't get a 200). Wait a few minutes and re-run, or raise PROBE_SETTLE_SILENCE_MS / PROBE_SETTLE_MAX_ATTEMPTS.";
    } else if (fast.length === 0) {
        verdict = "INCONCLUSIVE — FAST phase did not run.";
    } else if (fast429 === 0) {
        verdict = `INCONCLUSIVE — never got a 429 at ${FAST_INTERVAL_MS / 1000}s cadence, so the limit is higher than this rate. Re-run with a smaller PROBE_FAST_INTERVAL_MS.`;
    } else if (fast200 === 0) {
        verdict =
            "429s very likely COUNT against the limit — we sent above the limit and stayed 100% locked out across the FAST phase (every rejection appears to refill the window).";
    } else {
        verdict =
            "429s very likely do NOT count — successes kept reappearing even while sending above the limit, i.e. only successful requests consume the window and age out of it.";
    }

    const lines = [
        "",
        "════════════════════════ SUMMARY ════════════════════════",
        `URL pool: ${URL_POOL.length} urls from ${URL_SOURCE}`,
        `Duration: ${fmtElapsed(Date.now() - t0)}  Total requests: ${total}`,
        `Results:  200=${ok}  429=${r429}  errors=${errs}  other=${other}`,
        recoveryInfo
            ? `Recovery from initial block: ~${(recoveryInfo.recoveredAfterMs / 1000).toFixed(0)}s of sparse probing (${recoveryInfo.gaps} gap(s))`
            : `Recovery from initial block: never recovered during the run`,
        "",
        `Burst capacity (BURST1): ${burst1 ? `${countSuccessesInPhase("BURST1")} before first 429` : "no 429 hit"}`,
        `Burst capacity (BURST2): ${events.some((e) => e.phase === "BURST2") ? `${countSuccessesInPhase("BURST2")} before first 429` : "n/a"}`,
        `Effective limit (max 200s in any ${WINDOW_MS / 1000}s window): ${effLimit}`,
        `Peak request rate (max reqs in any ${WINDOW_MS / 1000}s window): ${reqRate}`,
        recoveryMs != null
            ? `Recovery: first success after the burst came ${(recoveryMs / 1000).toFixed(1)}s after the last burst success` +
              ` (≈ window length if 429s don't count)`
            : "Recovery: not observed",
        "",
        MODE === "steady"
            ? `STEADY phase (every ${STEADY_INTERVAL_MS / 1000}s = ${(60000 / STEADY_INTERVAL_MS).toFixed(1)}/min): 200=${s200}  429=${s429}  first-429=${firstS429 ? `${firstS429At}s in` : "never"}`
            : `FAST phase (every ${FAST_INTERVAL_MS / 1000}s): 200=${fast200}  429=${fast429}`,
        `Retry-After values seen: ${retryAfters.length ? retryAfters.join(", ") : "none"}`,
        `Rate-limit-ish headers seen: ${rlHeaderKeys.length ? rlHeaderKeys.join(", ") : "none"}`,
        "",
        MODE === "steady"
            ? "VERDICT — is this request rate sustainable?"
            : "VERDICT — does a 429 count against the limit?",
        `  ${verdict}`,
        "",
        `Logs: ${path.relative(ROOT, txtPath)}  |  ${path.relative(ROOT, jsonlPath)}`,
        "══════════════════════════════════════════════════════════",
    ];
    for (const l of lines) line(l);
}

function countSuccessesInPhase(phase) {
    // successes that occurred before the first 429 in that phase
    let n = 0;
    for (const e of events) {
        if (e.phase !== phase) continue;
        if (e.status === 429) break;
        if (e.ok) n++;
    }
    return n;
}

// ── Main ──────────────────────────────────────────────────────────────────────
let finished = false;
function finish(reason) {
    if (finished) return;
    finished = true;
    line(`\nStopping (${reason}). Analyzing ${events.length} requests…`);
    analyze();
    // Wait for the log streams to flush before exiting (process.exit can otherwise drop the
    // buffered summary — which is what truncated an earlier SIGINT run's log file).
    let pending = 2;
    const done = () => {
        if (--pending === 0) process.exit(0);
    };
    txtStream.on("finish", done);
    jsonlStream.on("finish", done);
    txtStream.end();
    jsonlStream.end();
    setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGINT", () => finish("SIGINT"));

(async () => {
    const durLabel = INFINITE ? "running until Ctrl+C" : `total ${Math.round(TOTAL_MS / 1000)}s`;
    line(`Song.link rate probe — ${durLabel}, ${URL_POOL.length} urls from ${URL_SOURCE}`);
    line(`Endpoint: ${API}  userCountry=${USER_COUNTRY}`);

    recoveryInfo = await runRecover();
    const recovered = recoveryInfo;
    if (!recovered) {
        finish("never recovered");
        return;
    }
    // The budget covers the experiment proper, not the (possibly long) recovery wait.
    deadline = INFINITE ? Infinity : Date.now() + TOTAL_MS;

    if (MODE === "steady") {
        const perMin = (60000 / STEADY_INTERVAL_MS).toFixed(1);
        line(`MODE=steady — pacing at 1 request / ${STEADY_INTERVAL_MS / 1000}s (${perMin}/min) for the whole run.`);
        await runInterval("STEADY", STEADY_INTERVAL_MS, timeLeft());
        finish("completed");
        return;
    }

    await runBurstUntil429("BURST1");
    if (timeLeft() > 0) await runInterval("FAST", FAST_INTERVAL_MS, FAST_PHASE_MS);

    if (timeLeft() > COOLDOWN_MS / 2) {
        const cool = Math.min(COOLDOWN_MS, timeLeft());
        line(`── COOLDOWN: sending nothing for ${Math.round(cool / 1000)}s to let the window clear ──`);
        await sleep(cool);
    }

    if (timeLeft() > 0) await runBurstUntil429("BURST2");
    if (timeLeft() > 0) await runInterval("SLOW", SLOW_INTERVAL_MS, timeLeft());

    finish("completed");
})().catch((e) => {
    line(`FATAL: ${e?.stack ?? e}`);
    finish("error");
});
