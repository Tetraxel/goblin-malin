import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Anomaly, Baseline, BaselineComparison, ComponentStat } from "./types.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BASELINE_DIR = path.join(HERE, "baselines");

// Render-count regressions are machine-independent → hard `error`.
// Render-time regressions are noisy across machines → advisory `warn`, with a
// generous multiplier plus absolute slack so dev-machine jitter doesn't trip it.
const COUNT_TOLERANCE = 0.5;
const COUNT_MIN_DELTA = 2;
const MS_TOLERANCE = 0.75;
const MS_SLACK = 3;

function baselinePath(scenario: string): string {
    const safe = scenario.replace(/[^a-z0-9._-]+/gi, "_");
    return path.join(BASELINE_DIR, `${safe}.json`);
}

export function loadBaseline(scenario: string): Baseline | undefined {
    const file = baselinePath(scenario);
    if (!fs.existsSync(file)) return undefined;
    try {
        return JSON.parse(fs.readFileSync(file, "utf8")) as Baseline;
    } catch {
        return undefined;
    }
}

export function saveBaseline(scenario: string, components: ComponentStat[], totals: { commits: number; reactMs: number }): void {
    const map: Baseline["components"] = {};
    for (const c of components) {
        map[c.name] = {
            renders: c.renders,
            selfMsP50: Math.round(c.selfMsTotal / Math.max(1, c.renders) * 1000) / 1000,
            selfMsP95: c.selfMsP95,
        };
    }
    const baseline: Baseline = {
        scenario,
        createdAt: new Date().toISOString(),
        totals: { commits: totals.commits, reactMs: Math.round(totals.reactMs * 100) / 100 },
        components: map,
    };
    fs.mkdirSync(BASELINE_DIR, { recursive: true });
    fs.writeFileSync(baselinePath(scenario), JSON.stringify(baseline, null, 2) + "\n");
}

export function compareToBaseline(scenario: string, components: ComponentStat[]): BaselineComparison {
    const baseline = loadBaseline(scenario);
    if (!baseline) return { exists: false, updated: false, regressions: [], newComponents: [] };

    const regressions: Anomaly[] = [];
    const newComponents: string[] = [];

    for (const c of components) {
        const base = baseline.components[c.name];
        if (!base) {
            newComponents.push(c.name);
            continue;
        }
        if (c.renders > base.renders * (1 + COUNT_TOLERANCE) && c.renders - base.renders >= COUNT_MIN_DELTA) {
            regressions.push({
                severity: "error",
                rule: "baseline-render-count",
                component: c.name,
                message: `${c.name} rendered ${c.renders}× (baseline ${base.renders})`,
                value: c.renders,
                threshold: base.renders,
            });
        }
        if (c.selfMsP95 > base.selfMsP95 * (1 + MS_TOLERANCE) + MS_SLACK) {
            regressions.push({
                severity: "warn",
                rule: "baseline-render-time",
                component: c.name,
                message: `${c.name} p95 self ${c.selfMsP95}ms (baseline ${base.selfMsP95}ms)`,
                value: c.selfMsP95,
                threshold: base.selfMsP95,
            });
        }
    }

    return { exists: true, updated: false, regressions, newComponents };
}
