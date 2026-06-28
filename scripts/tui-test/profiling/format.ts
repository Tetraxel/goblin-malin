import type { ProfileReport } from "./types.ts";

const R = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GRAY = "\x1b[90m";
const GREEN = "\x1b[92m";
const YELLOW = "\x1b[93m";
const RED = "\x1b[91m";
const CYAN = "\x1b[96m";

function bar(label: string): string {
    const inner = ` ${label} `;
    const fill = Math.max(0, 80 - inner.length);
    const left = Math.floor(fill / 2);
    return GRAY + "─".repeat(left) + R + BOLD + inner + R + GRAY + "─".repeat(fill - left) + R;
}

/** Human-readable profile section for the `--pretty` CLI. */
export function formatProfile(p: ProfileReport): string {
    const lines: string[] = [];
    lines.push("\n" + bar("profile"));

    const t = p.totals;
    lines.push(
        `  ${GRAY}commits${R} ${t.commits}   ${GRAY}react${R} ${t.reactMs}ms   ` +
            `${GRAY}ink frames${R} ${t.inkFrames} (${t.inkMs}ms)   ${GRAY}worst commit${R} ${t.maxCommitMs}ms   ` +
            `${GRAY}components${R} ${t.components}`
    );

    // Top components by total self time.
    lines.push("\n  " + BOLD + "top components (by self ms)" + R);
    lines.push(`  ${GRAY}${"component".padEnd(28)}${"renders".padStart(8)}${"self ms".padStart(10)}${"p95".padStart(8)}${"wasted".padStart(8)}${R}`);
    for (const c of p.components.slice(0, 15)) {
        const wastedColor = c.wasted > 0 ? YELLOW : GRAY;
        lines.push(
            `  ${c.name.padEnd(28)}${String(c.renders).padStart(8)}${c.selfMsTotal.toFixed(2).padStart(10)}` +
                `${c.selfMsP95.toFixed(2).padStart(8)}${wastedColor}${String(c.wasted).padStart(8)}${R}`
        );
    }

    // Per-interaction breakdown.
    lines.push("\n  " + BOLD + "interactions" + R);
    for (const it of p.interactions) {
        const tag = it.index < 0 ? `${DIM}boot${R}` : `${CYAN}${it.label}${R}`;
        const top = it.topComponents
            .slice(0, 3)
            .map((c) => `${c.name}×${c.renders}`)
            .join(" ");
        lines.push(
            `  ${tag.padEnd(28)} ${GRAY}commits${R} ${String(it.commits).padStart(3)}  ` +
                `${GRAY}react${R} ${String(it.reactMs).padStart(6)}ms  ${GRAY}ink${R} ${String(it.inkMs).padStart(6)}ms  ` +
                `${GRAY}wasted${R} ${String(it.wasted).padStart(4)}   ${DIM}${top}${R}`
        );
    }

    // Anomalies.
    const errors = p.anomalies.filter((a) => a.severity === "error");
    const warns = p.anomalies.filter((a) => a.severity === "warn");
    lines.push("\n  " + BOLD + "anomalies" + R);
    if (p.anomalies.length === 0) {
        lines.push(`  ${GREEN}none${R}`);
    } else {
        for (const a of errors) lines.push(`  ${RED}ERROR${R} ${GRAY}[${a.rule}]${R} ${a.message}`);
        for (const a of warns) lines.push(`  ${YELLOW}warn${R}  ${GRAY}[${a.rule}]${R} ${a.message}`);
    }

    if (p.baseline) {
        if (p.baseline.updated) {
            lines.push(`\n  ${GREEN}baseline updated${R}`);
        } else if (!p.baseline.exists) {
            lines.push(`\n  ${DIM}no baseline yet — run with --update-baseline to create one${R}`);
        } else {
            const reg = p.baseline.regressions.length;
            const nc = p.baseline.newComponents.length;
            lines.push(`\n  ${GRAY}baseline${R} ${reg === 0 ? GREEN + "no regressions" + R : RED + reg + " regression(s)" + R}` + (nc > 0 ? ` ${DIM}(${nc} new component(s))${R}` : ""));
        }
    }

    lines.push(bar(""));
    return lines.join("\n");
}
