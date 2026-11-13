/**
 * Compares two stored suite results (see perfSuite.ts).
 *
 *   yarn tsx scripts/tui-test/perfCompare.ts before after
 *
 * Prints, per scenario, the totals and the interactions that changed, with the difference in percent.
 * Counts (commits, frames, renders) are reliable; milliseconds are only indicative (machine noise is a few %).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SuiteResult } from "./perfSuite.ts";

const RESULTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "profiling", "results");

const R = "\x1b[0m";
const GRAY = "\x1b[90m";
const GREEN = "\x1b[92m";
const RED = "\x1b[91m";
const BOLD = "\x1b[1m";

const [, , beforeName, afterName] = process.argv;
if (!beforeName || !afterName) {
    process.stderr.write("Usage: tsx scripts/tui-test/perfCompare.ts <before-label> <after-label>\n");
    process.exit(1);
}

const load = (name: string): SuiteResult =>
    JSON.parse(
        fs.readFileSync(fs.existsSync(name) ? name : path.join(RESULTS_DIR, `${name}.json`), "utf-8")
    ) as SuiteResult;
const before = load(beforeName);
const after = load(afterName);

/** Differences smaller than this (in percent) are shown as noise. */
const NOISE_PCT = 8;

function delta(a: number, b: number): string {
    if (a === b) return `${GRAY}   =${R}`;
    if (a === 0) return `${RED}  new${R}`;
    const pct = ((b - a) / a) * 100;
    const text = `${pct > 0 ? "+" : ""}${Math.round(pct)}%`.padStart(6);
    if (Math.abs(pct) < NOISE_PCT) return `${GRAY}${text}${R}`;
    return `${pct < 0 ? GREEN : RED}${text}${R}`;
}

const num = (n: number): string => String(Math.round(n * 10) / 10).padStart(9);

function row(label: string, a: number, b: number): string {
    return `  ${label.padEnd(30)}${num(a)}${num(b)}  ${delta(a, b)}`;
}

process.stdout.write(
    `${BOLD}${before.label}${R} (${before.date.slice(0, 16)})  →  ${BOLD}${after.label}${R} (${after.date.slice(0, 16)})\n`
);
process.stdout.write(
    `${GRAY}runs per scenario: ${before.runs} → ${after.runs}, medians. green = better, red = worse (beyond ${NOISE_PCT}%)${R}\n`
);

for (const name of Object.keys(before.scenarios)) {
    const a = before.scenarios[name]!;
    const b = after.scenarios[name];
    process.stdout.write(`\n${BOLD}${name}${R}\n`);
    if (!b) {
        process.stdout.write(`  ${GRAY}(not in "${after.label}")${R}\n`);
        continue;
    }
    process.stdout.write(
        `  ${GRAY}${"".padEnd(30)}${before.label.slice(0, 8).padStart(9)}${after.label.slice(0, 8).padStart(9)}${R}\n`
    );
    process.stdout.write(row("boot (ms to first stable)", a.bootMs, b.bootMs) + "\n");
    for (const key of [
        ...["commits", "inkFrames", "reactMs", "inkMs", "layoutMs", "writeMs", "bytes"],
        ...["cpuMs", "lagMaxMs", "heapMaxMb"],
    ] as const) {
        // Results stored before layout / write / bytes were recorded have no such field.
        process.stdout.write(row(key, a.totals[key] ?? 0, b.totals[key] ?? 0) + "\n");
    }

    // Interactions whose cost moved.
    const lines: string[] = [];
    a.interactions.forEach((it, i) => {
        const other = b.interactions[i];
        if (!other) return;
        const moved = (["commits", "inkFrames", "cpuMs", "lagMaxMs"] as const).some(
            (k) =>
                it[k] !== other[k] &&
                Math.abs(((other[k] - it[k]) / Math.max(it[k], 1)) * 100) >= NOISE_PCT &&
                Math.abs(other[k] - it[k]) >= 1
        );
        if (!moved) return;
        lines.push(
            `  ${GRAY}${it.label.slice(0, 18).padEnd(18)}${R} commits ${String(it.commits).padStart(4)}→${String(other.commits).padEnd(4)}` +
                ` frames ${String(it.inkFrames).padStart(4)}→${String(other.inkFrames).padEnd(4)}` +
                ` cpu ${String(it.cpuMs).padStart(5)}→${String(other.cpuMs).padEnd(5)}ms` +
                ` block ${String(it.lagMaxMs).padStart(6)}→${String(other.lagMaxMs).padEnd(6)}ms`
        );
    });
    if (lines.length > 0) process.stdout.write(`  ${GRAY}interactions that changed:${R}\n${lines.join("\n")}\n`);

    // Components whose render count moved a lot.
    const comps: string[] = [];
    for (const [cname, ca] of Object.entries(a.components)) {
        const cb = b.components[cname];
        if (!cb || ca.renders < 3) continue;
        const pct = ((cb.renders - ca.renders) / ca.renders) * 100;
        if (Math.abs(pct) >= 25 && Math.abs(cb.renders - ca.renders) >= 3 && cname !== "Box" && cname !== "Text") {
            comps.push(`${cname} ${ca.renders}→${cb.renders}`);
        }
    }
    if (comps.length > 0) process.stdout.write(`  ${GRAY}renders:${R} ${comps.slice(0, 10).join(", ")}\n`);
}

if (before.latency && after.latency) {
    process.stdout.write(
        `\n${BOLD}key latency${R} ${GRAY}(built bundle, 2,000 tasks, truecolor; ms, p50 of the keys)${R}\n`
    );
    process.stdout.write(
        `  ${GRAY}${"".padEnd(26)}${"first byte".padStart(16)}${"settled".padStart(16)}${"bytes/key".padStart(18)}${"backlog".padStart(16)}${R}\n`
    );
    const cell = (x: number, y: number, unit = ""): string =>
        `${num(x)}→${(String(Math.round(y * 10) / 10) + unit).padEnd(6)} ${delta(x, y)}`;
    for (const [name, a] of Object.entries(before.latency)) {
        const b = after.latency[name];
        if (!b) continue;
        process.stdout.write(
            `  ${name.padEnd(26)}${cell(a.firstByteMs, b.firstByteMs)}${cell(a.settledMs, b.settledMs)}` +
                `${cell(a.bytesPerKey, b.bytesPerKey)}${a.backlogMs || b.backlogMs ? cell(a.backlogMs, b.backlogMs) : ""}\n`
        );
    }
}

if (before.bench.length > 0) {
    process.stdout.write(`\n${BOLD}micro-benchmarks${R}\n`);
    process.stdout.write(
        `  ${GRAY}${"".padEnd(24)}${"ms".padStart(18)}${"cpu ms".padStart(18)}${"block ms".padStart(20)}${R}\n`
    );
    for (const a of before.bench) {
        const b = after.bench.find((x) => x.name === a.name);
        if (!b) continue;
        const cell = (x: number, y: number): string => `${num(x)}→${String(Math.round(y * 10) / 10).padEnd(7)}`;
        process.stdout.write(
            `  ${a.name.padEnd(24)}${cell(a.ms, b.ms)} ${delta(a.ms, b.ms)} ${cell(a.cpuMs, b.cpuMs)}${cell(a.lagMaxMs, b.lagMaxMs)} ${delta(a.lagMaxMs, b.lagMaxMs)}\n`
        );
    }
}
