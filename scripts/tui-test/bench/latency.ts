/**
 * End-to-end key latency, as a user feels it: the time from writing a key to the PTY until the app's output for it
 * has settled, plus the bytes the terminal had to parse for it. Works on the shipped bundle (no profiling hooks),
 * which is what users run.
 *
 *   yarn tsx scripts/tui-test/bench/latency.ts [--cmd "node dist/cli.js"] [--tasks 2000] [--cols 128 --rows 50]
 *        [--key ArrowDown] [--count 40] [--interval 120] [--burst 30 --burst-interval 33] [--settings '{"…":…}']
 *        [--back-key Escape] [--pre ArrowDown] [--color 3] [--fixture scripts/tui-test/fixtures/50-tasks-with-metadata]
 *        [--dump frame.bin] [--json]
 *
 * `--back-key` alternates with `--key` (Ctrl+A / Escape, 2 / 1). `--color` is FORCE_COLOR (default 3, truecolor,
 * what Windows Terminal and most modern terminals get; the scenario runner uses 1). `--dump` writes the raw output of
 * the last paced key (and `<file>.times`: each chunk's offset from the key and its size).
 * Build first (`yarn build`): the default command is the shipped bundle.
 *
 * Two phases:
 *   - "paced": `count` keys, one every `interval` ms (long enough for each to settle): per-key latency to the first
 *     byte and to the last byte, and bytes per key.
 *   - "burst": `burst` keys every `burst-interval` ms, like a held arrow key (OS auto-repeat is ~30/s): how long the
 *     screen keeps changing after the last key (the backlog the user sees as "lag behind the key").
 */
import * as pty from "node-pty";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createIsolatedDataDir } from "../isolatedDataDir.ts";
import { scaleSessionsFile } from "../scaleFixture.ts";
import { resolveKey } from "../keyMap.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const arg = (name: string, def?: string): string | undefined => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : def;
};
const num = (name: string, def: number): number => Number(arg(name, String(def)));

const cmd = arg("cmd", "node dist/cli.js")!;
const tasks = num("tasks", 0);
const otherSessions = num("other-sessions", 0);
const cols = num("cols", 128);
const rows = num("rows", 50);
const key = resolveKey(arg("key", "ArrowDown")!);
const backKey = arg("back-key") ? resolveKey(arg("back-key")!) : undefined;
const count = num("count", 40);
const interval = num("interval", 150);
const burst = num("burst", 30);
const burstInterval = num("burst-interval", 33);
const fixture = arg("fixture", "scripts/tui-test/fixtures/50-tasks-with-metadata")!;
const settings = arg("settings") ? JSON.parse(arg("settings")!) : undefined;
// Keys sent once before measuring (comma-separated), e.g. `--pre ArrowDown` to put the cursor on the list.
const pre = (arg("pre") ?? "").split(",").filter(Boolean).map(resolveKey);
const asJson = process.argv.includes("--json");

const isolated = createIsolatedDataDir(path.resolve(ROOT, fixture), settings);
if (tasks > 0) scaleSessionsFile(isolated.dir, { tasks, otherSessions });

const env: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
Object.assign(env, {
    TERM: "xterm-256color",
    FORCE_COLOR: arg("color", "3")!,
    COLORTERM: "truecolor",
    GOBLIN_NO_AUDIO: "1",
    GOBLIN_DATA_DIR: isolated.dir,
});

interface Chunk {
    t: number;
    n: number;
    d: string;
}
const chunks: Chunk[] = [];
let total = 0;
let lastData = 0;
const t0 = performance.now();
const p = pty.spawn("/bin/sh", ["-c", cmd], { name: "xterm-256color", cols, rows, cwd: ROOT, env });
let screen = "";
p.onData((d) => {
    const now = performance.now();
    chunks.push({ t: now, n: Buffer.byteLength(d), d });
    total += Buffer.byteLength(d);
    lastData = now;
    if (screen.length < 2_000_000) screen += d;
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function quiet(ms: number, timeout = 60000): Promise<void> {
    const start = performance.now();
    while (performance.now() - start < timeout) {
        if (total > 1000 && performance.now() - lastData >= ms) return;
        await sleep(10);
    }
}

function window(from: number, to: number): { first?: number; last?: number; bytes: number; writes: number } {
    let first: number | undefined;
    let last: number | undefined;
    let bytes = 0;
    let writes = 0;
    for (const c of chunks) {
        if (c.t < from || c.t >= to) continue;
        first ??= c.t;
        last = c.t;
        bytes += c.n;
        writes++;
    }
    return { first, last, bytes, writes };
}

const pct = (xs: number[], q: number): number => {
    if (!xs.length) return NaN;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
};
const r1 = (x: number) => Math.round(x * 10) / 10;

let pacedLastSent = 0;
async function main(): Promise<void> {
    await quiet(1500);
    const bootMs = lastData - t0;
    await sleep(2000); // start-up maintenance, deferred loads
    await quiet(500);
    for (const k of pre) {
        p.write(k);
        await sleep(300);
    }
    await quiet(500);

    // Paced keys.
    const paced: { first: number; last: number; bytes: number; writes: number }[] = [];
    for (let i = 0; i < count; i++) {
        const k = backKey && i % 2 === 1 ? backKey : key;
        const sent = performance.now();
        pacedLastSent = sent;
        p.write(k);
        await sleep(interval);
        const w = window(sent, sent + interval);
        if (w.first !== undefined) {
            paced.push({ first: w.first - sent, last: w.last! - sent, bytes: w.bytes, writes: w.writes });
        } else {
            paced.push({ first: NaN, last: NaN, bytes: 0, writes: 0 });
        }
    }
    await quiet(500);

    // Burst (held key).
    const burstStart = performance.now();
    for (let i = 0; i < burst; i++) {
        // With a back key, the first half of the burst goes forward and the second half back.
        p.write(backKey && Math.floor((i / burst) * 2) === 1 ? backKey : key);
        await sleep(burstInterval);
    }
    const lastKey = performance.now();
    await quiet(400, 20000);
    const settle = lastData - lastKey;
    const bw = window(burstStart, lastData + 1);

    const firsts = paced.map((x) => x.first).filter((x) => !Number.isNaN(x));
    const lasts = paced.map((x) => x.last).filter((x) => !Number.isNaN(x));
    const bytes = paced.map((x) => x.bytes);
    const result = {
        cmd,
        tasks,
        cols,
        rows,
        bootMs: Math.round(bootMs),
        paced: {
            keys: count,
            noOutput: paced.filter((x) => Number.isNaN(x.first)).length,
            firstByteP50: r1(pct(firsts, 0.5)),
            firstByteP95: r1(pct(firsts, 0.95)),
            settledP50: r1(pct(lasts, 0.5)),
            settledP95: r1(pct(lasts, 0.95)),
            bytesPerKeyP50: pct(bytes, 0.5),
            bytesPerKeyMax: Math.max(...bytes),
            writesPerKeyP50: pct(
                paced.map((x) => x.writes),
                0.5
            ),
        },
        burst: {
            keys: burst,
            intervalMs: burstInterval,
            durationMs: Math.round(lastKey - burstStart),
            settleAfterLastKeyMs: Math.round(settle),
            bytes: bw.bytes,
            writes: bw.writes,
        },
    };
    const dump = arg("dump");
    if (dump) {
        // Raw output of the last paced key, to look at what a frame is made of.
        const fs = await import("node:fs");
        const keyChunks = chunks.filter((c) => c.t >= pacedLastSent && c.t < pacedLastSent + interval);
        fs.writeFileSync(dump, keyChunks.map((c) => c.d).join(""));
        fs.writeFileSync(
            dump + ".times",
            keyChunks.map((c) => `${(c.t - pacedLastSent).toFixed(1)} ${c.n}`).join("\n")
        );
    }
    p.kill();
    await sleep(500); // let the app exit before its data folder goes
    isolated.dispose();
    if (asJson) console.log(JSON.stringify(result));
    else console.log(JSON.stringify(result, null, 2));
    process.exit(0);
}

main().catch((e) => {
    console.error(e);
    p.kill();
    isolated.dispose();
    process.exit(1);
});
