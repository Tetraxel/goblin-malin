import fs from "node:fs";
import { compareToBaseline, saveBaseline } from "./baseline.ts";
import { resolveThresholds } from "./thresholds.ts";
import type {
    Anomaly,
    CommitRecord,
    ComponentStat,
    InkFrameRecord,
    InteractionMark,
    InteractionStat,
    ProfileRecord,
    ProfileReport,
    Thresholds,
} from "./types.ts";

const TOP_COMPONENTS = 40;
const TOP_PER_INTERACTION = 6;

// Ink's own layout primitives re-render with the tree on every full redraw and
// cannot be memoized by app code. They dominate raw "wasted render" counts, so
// the interaction-level wasted signal excludes them — leaving only app
// components the author can actually do something about. They remain in the
// per-component table (where they show the true redraw volume).
const INK_PRIMITIVES = new Set(["Box", "Text", "Static", "Spacer", "Newline", "Transform"]);

export function readRecords(filePath: string): ProfileRecord[] {
    if (!fs.existsSync(filePath)) return [];
    const out: ProfileRecord[] = [];
    for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
        const s = line.trim();
        if (!s) continue;
        try {
            out.push(JSON.parse(s) as ProfileRecord);
        } catch {
            // Tolerate a truncated final line from a hard-killed process.
        }
    }
    return out;
}

function percentile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return Math.round(sorted[idx] * 1000) / 1000;
}

function isParentOnly(changes: string[]): boolean {
    return changes.length === 1 && changes[0] === "parent";
}

interface Bucket {
    index: number;
    label: string;
    commits: CommitRecord[];
    inks: InkFrameRecord[];
}

function bucketize(records: ProfileRecord[], marks: InteractionMark[]): Bucket[] {
    const sorted = [...marks].sort((a, b) => a.t - b.t);
    const buckets: Bucket[] = [{ index: -1, label: "boot", commits: [], inks: [] }];
    for (const m of sorted) buckets.push({ index: m.index, label: m.label, commits: [], inks: [] });

    const bucketFor = (t: number): Bucket => {
        let chosen = buckets[0]!;
        for (let i = 0; i < sorted.length; i++) {
            if (t >= sorted[i]!.t) chosen = buckets[i + 1]!;
            else break;
        }
        return chosen;
    };

    for (const r of records) {
        const b = bucketFor(r.t);
        if (r.type === "commit") b.commits.push(r);
        else b.inks.push(r);
    }
    return buckets;
}

function aggregateComponents(commits: CommitRecord[]): ComponentStat[] {
    const selfTimes = new Map<string, number[]>();
    const stats = new Map<string, ComponentStat>();

    for (const commit of commits) {
        for (const comp of commit.components) {
            let s = stats.get(comp.name);
            if (!s) {
                s = { name: comp.name, renders: 0, mounts: 0, updates: 0, selfMsTotal: 0, selfMsMax: 0, selfMsP95: 0, wasted: 0 };
                stats.set(comp.name, s);
                selfTimes.set(comp.name, []);
            }
            s.renders++;
            s.selfMsTotal += comp.self;
            s.selfMsMax = Math.max(s.selfMsMax, comp.self);
            if (comp.phase === "mount") s.mounts++;
            else s.updates++;
            if (comp.phase === "update" && isParentOnly(comp.changes)) s.wasted++;
            selfTimes.get(comp.name)!.push(comp.self);
        }
    }

    for (const s of stats.values()) {
        s.selfMsTotal = Math.round(s.selfMsTotal * 1000) / 1000;
        s.selfMsP95 = percentile(selfTimes.get(s.name)!, 95);
    }
    return [...stats.values()].sort((a, b) => b.selfMsTotal - a.selfMsTotal);
}

function interactionStat(b: Bucket): InteractionStat {
    const reactMs = b.commits.reduce((sum, c) => sum + c.durationMs, 0);
    const inkMs = b.inks.reduce((sum, f) => sum + f.renderMs, 0);
    let wasted = 0;
    const bySelf = new Map<string, { renders: number; selfMs: number }>();
    for (const c of b.commits) {
        for (const comp of c.components) {
            if (comp.phase === "update" && isParentOnly(comp.changes) && !INK_PRIMITIVES.has(comp.name)) wasted++;
            const e = bySelf.get(comp.name) ?? { renders: 0, selfMs: 0 };
            e.renders++;
            e.selfMs += comp.self;
            bySelf.set(comp.name, e);
        }
    }
    const topComponents = [...bySelf.entries()]
        .map(([name, e]) => ({ name, renders: e.renders, selfMs: Math.round(e.selfMs * 1000) / 1000 }))
        .sort((a, b2) => b2.selfMs - a.selfMs)
        .slice(0, TOP_PER_INTERACTION);

    return {
        index: b.index,
        label: b.label,
        commits: b.commits.length,
        reactMs: Math.round(reactMs * 100) / 100,
        inkFrames: b.inks.length,
        inkMs: Math.round(inkMs * 100) / 100,
        wasted,
        topComponents,
    };
}

function detectAnomalies(
    buckets: Bucket[],
    components: ComponentStat[],
    interactions: InteractionStat[],
    thresholds: Thresholds
): Anomaly[] {
    const anomalies: Anomaly[] = [];

    // Per-interaction (boot excluded — initial mounts legitimately burst).
    for (const it of interactions) {
        if (it.index < 0) continue;
        if (it.commits > thresholds.maxCommitsPerInteraction) {
            anomalies.push({
                severity: "error",
                rule: "commit-cascade",
                interaction: it.label,
                message: `"${it.label}" triggered ${it.commits} commits (cascade/effect-loop?)`,
                value: it.commits,
                threshold: thresholds.maxCommitsPerInteraction,
            });
        }
        if (it.reactMs > thresholds.maxInteractionReactMs) {
            anomalies.push({
                severity: "warn",
                rule: "slow-interaction",
                interaction: it.label,
                message: `"${it.label}" spent ${it.reactMs}ms in React render`,
                value: it.reactMs,
                threshold: thresholds.maxInteractionReactMs,
            });
        }
        if (it.wasted > thresholds.maxWastedRendersPerInteraction) {
            anomalies.push({
                severity: "warn",
                rule: "wasted-renders",
                interaction: it.label,
                message: `"${it.label}" caused ${it.wasted} parent-only re-renders (memoization opportunity)`,
                value: it.wasted,
                threshold: thresholds.maxWastedRendersPerInteraction,
            });
        }
    }

    // Slowest single commit, over interaction commits only (skip boot mounts).
    let worstCommit = 0;
    let overCount = 0;
    for (const b of buckets) {
        if (b.index < 0) continue;
        for (const c of b.commits) {
            worstCommit = Math.max(worstCommit, c.durationMs);
            if (c.durationMs > thresholds.maxCommitDurationMs) overCount++;
        }
    }
    if (overCount > 0) {
        anomalies.push({
            severity: "warn",
            rule: "slow-commit",
            message: `${overCount} commit(s) over ${thresholds.maxCommitDurationMs}ms (worst ${Math.round(worstCommit * 100) / 100}ms)`,
            value: Math.round(worstCommit * 100) / 100,
            threshold: thresholds.maxCommitDurationMs,
        });
    }

    // Per-component p95 self render time.
    for (const c of components) {
        if (c.selfMsP95 > thresholds.maxComponentSelfMsP95) {
            anomalies.push({
                severity: "warn",
                rule: "slow-component",
                component: c.name,
                message: `${c.name} p95 self render ${c.selfMsP95}ms (over ${thresholds.maxComponentSelfMsP95}ms)`,
                value: c.selfMsP95,
                threshold: thresholds.maxComponentSelfMsP95,
            });
        }
    }

    return anomalies;
}

export interface AnalyzeOptions {
    marks: InteractionMark[];
    thresholds?: Partial<Thresholds>;
    scenario?: string;
    updateBaseline?: boolean;
}

export function analyzeRecords(records: ProfileRecord[], options: AnalyzeOptions): ProfileReport {
    const thresholds = resolveThresholds(options.thresholds);
    const buckets = bucketize(records, options.marks);
    const allCommits = records.filter((r): r is CommitRecord => r.type === "commit");
    const allInks = records.filter((r): r is InkFrameRecord => r.type === "ink");

    const components = aggregateComponents(allCommits);
    const interactions = buckets.map(interactionStat);
    const anomalies = detectAnomalies(buckets, components, interactions, thresholds);

    const maxCommitMs = allCommits.reduce((m, c) => Math.max(m, c.durationMs), 0);
    const report: ProfileReport = {
        scenario: options.scenario,
        totals: {
            commits: allCommits.length,
            reactMs: Math.round(allCommits.reduce((s, c) => s + c.durationMs, 0) * 100) / 100,
            inkFrames: allInks.length,
            inkMs: Math.round(allInks.reduce((s, f) => s + f.renderMs, 0) * 100) / 100,
            components: components.length,
            maxCommitMs: Math.round(maxCommitMs * 100) / 100,
        },
        components: components.slice(0, TOP_COMPONENTS),
        interactions,
        anomalies,
        thresholds,
    };

    // Baseline: regenerate or compare (keyed by scenario name).
    if (options.scenario) {
        if (options.updateBaseline) {
            saveBaseline(options.scenario, components, { commits: report.totals.commits, reactMs: report.totals.reactMs });
            report.baseline = { exists: true, updated: true, regressions: [], newComponents: [] };
        } else {
            const cmp = compareToBaseline(options.scenario, components);
            report.baseline = cmp;
            report.anomalies.push(...cmp.regressions);
        }
    }

    return report;
}

export function analyzeProfileFile(filePath: string, options: AnalyzeOptions): ProfileReport {
    return analyzeRecords(readRecords(filePath), options);
}
