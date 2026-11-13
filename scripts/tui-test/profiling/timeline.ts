/**
 * Prints the commits of a profiling run one by one (what rendered, why), to find render cascades and wasted
 * renders that the per-component totals hide.
 *
 *   yarn tsx scripts/tui-test/profiling/timeline.ts <profile.jsonl> [--from <ms>] [--to <ms>] [--top 6]
 *
 * The `.jsonl` files are left in the OS temp folder, in `goblin-tui-test/profile-<id>.jsonl`, by every profiled
 * run (`ls -t` for the latest). Times are relative to the first record; `--from` / `--to` select a window.
 * A line per commit: when, how long React took, then the components that did the most work, each with the
 * reason it rendered (`prop:x`, `state#n`, `parent`) and how many times it rendered in that commit.
 * Ink's own `Box` / `Text` are left out: they follow the tree.
 */
import path from "node:path";
import { readRecords } from "./analyze.ts";
import type { CommitRecord, InkFrameRecord, RuntimeRecord } from "./types.ts";

const INK_PRIMITIVES = new Set(["Box", "Text", "Static", "Spacer", "Newline", "Transform"]);

function flag(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

const file = process.argv[2];
if (!file || file.startsWith("--")) {
    process.stderr.write(
        "Usage: tsx scripts/tui-test/profiling/timeline.ts <profile.jsonl> [--from ms] [--to ms] [--top N]\n"
    );
    process.exit(1);
}

const records = readRecords(path.resolve(file));
const t0 = records[0]?.t ?? 0;
const from = Number(flag("from") ?? 0);
const to = Number(flag("to") ?? Infinity);
const top = Number(flag("top") ?? 6);

const commits = records.filter((r): r is CommitRecord => r.type === "commit");
const inks = records.filter((r): r is InkFrameRecord => r.type === "ink");
const runtimes = records.filter((r): r is RuntimeRecord => r.type === "runtime");

const rel = (t: number): number => t - t0;
let lastT = -Infinity;
let shown = 0;

for (const c of commits) {
    const t = rel(c.t);
    if (t < from || t > to) continue;
    shown++;

    // Components of this commit grouped by name, with how often and why.
    const byName = new Map<string, { n: number; self: number; why: Set<string> }>();
    for (const comp of c.components) {
        if (INK_PRIMITIVES.has(comp.name)) continue;
        const e = byName.get(comp.name) ?? { n: 0, self: 0, why: new Set<string>() };
        e.n++;
        e.self += comp.self;
        for (const w of comp.changes) e.why.add(w);
        if (comp.phase === "mount") e.why.add("mount");
        byName.set(comp.name, e);
    }
    const list = [...byName.entries()]
        .sort((a, b) => b[1].self - a[1].self)
        .slice(0, top)
        .map(
            ([name, e]) =>
                `${name}${e.n > 1 ? `×${e.n}` : ""}[${[...e.why].slice(0, 3).join(",")}] ${e.self.toFixed(1)}`
        )
        .join("  ");
    const gap = lastT === -Infinity ? "" : `+${Math.round(t - lastT)}ms`;
    lastT = t;
    process.stdout.write(
        `${String(Math.round(t)).padStart(7)}ms ${gap.padStart(8)}  react ${c.durationMs.toFixed(1).padStart(6)}ms  ${list}\n`
    );
}

const inRange = <T extends { t: number }>(r: T): boolean => rel(r.t) >= from && rel(r.t) <= to;
const frames = inks.filter(inRange);
const samples = runtimes.filter(inRange);
process.stdout.write(
    `\n${shown} commits, ${frames.length} ink frames (${frames.reduce((s, f) => s + f.renderMs, 0).toFixed(0)}ms), ` +
        `cpu ${samples.reduce((s, r) => s + r.cpuMs, 0).toFixed(0)}ms, longest block ${Math.max(0, ...samples.map((r) => r.lagMaxMs)).toFixed(0)}ms\n`
);
