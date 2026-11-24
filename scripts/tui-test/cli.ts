import { readFileSync } from "node:fs";
import path from "node:path";
import { runScenario } from "./runner.ts";
import { runSuite, type SuiteResult } from "./suite.ts";
import { parseScenario } from "./parseScenario.ts";
import { formatProfile } from "./profiling/format.ts";
import type { HarnessEvent, HarnessResult } from "./types.ts";

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith("--"));
const positional = args.filter((a, i) => !a.startsWith("--") && !flagTakesValue(args[i - 1]));
const pretty = flags.includes("--pretty");
const profile = flags.includes("--profile");
const updateBaseline = flags.includes("--update-baseline");
const updateGolden = flags.includes("--update-golden");
const all = flags.includes("--all");
const scenarioPath = positional[0];

/** Flags followed by a value (`--parallel 4`). */
function flagTakesValue(flag: string | undefined): boolean {
    return flag === "--parallel" || flag === "--filter" || flag === "--timeout" || flag === "--dir";
}

function flagValue(name: string): string | undefined {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
}

if (!scenarioPath && !all) {
    process.stderr.write(
        [
            "Usage: tsx scripts/tui-test/cli.ts <scenario.json> [--pretty] [--profile] [--update-baseline] [--update-golden]",
            "       tsx scripts/tui-test/cli.ts --all [--filter a,b] [--parallel 2] [--include-perf] [--screenshots] [--update-golden] [--json]",
            "",
            "--all runs every scenario of scripts/tui-test/examples (not perf-* / profile-*) and prints a pass/fail table.",
            "Interactive sessions (one app kept running, a command at a time): tsx scripts/tui-test/sessionCli.ts help",
            "",
        ].join("\n")
    );
    process.exit(1);
}

// ANSI helpers
const R = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[96m";
const YELLOW = "\x1b[93m";
const GREEN = "\x1b[92m";
const RED = "\x1b[91m";
const GRAY = "\x1b[90m";

const W = 80;

function sep(label = "", char = "─"): string {
    if (!label) return GRAY + char.repeat(W) + R;
    const inner = ` ${label} `;
    const fill = Math.max(0, W - inner.length);
    const left = Math.floor(fill / 2);
    return GRAY + char.repeat(left) + R + BOLD + inner + R + GRAY + char.repeat(fill - left) + R;
}

function printMetrics(result: HarnessResult): void {
    process.stdout.write("\n" + sep("metrics") + "\n");
    for (const [key, val] of Object.entries(result.metrics)) {
        const isTime = typeof val === "number";
        const valStr = isTime ? `${val}ms` : String(val);
        const color = typeof val === "boolean" && val ? RED : isTime ? GREEN : GRAY;
        process.stdout.write(`  ${GRAY}${key.padEnd(40)}${R}${color}${valStr}${R}\n`);
    }
    const code = result.exitCode;
    const codeStr =
        code === null ? `${GREEN}null${R}${GRAY} (clean harness kill)${R}` : `${code === 0 ? GREEN : RED}${code}${R}`;
    process.stdout.write(`\n  ${GRAY}exit code${R.padEnd(0)}  ${" ".repeat(31)}${codeStr}\n`);
}

function makeLiveHandler(): (event: HarnessEvent) => void {
    return (event) => {
        switch (event.type) {
            case "key":
                process.stdout.write(`  ${CYAN}key${R}        ${event.key}\n`);
                break;
            case "type":
                process.stdout.write(`  ${CYAN}type${R}       ${YELLOW}${JSON.stringify(event.text)}${R}\n`);
                break;
            case "wait":
                process.stdout.write(`  ${CYAN}wait${R}       ${DIM}${event.ms}ms${R}\n`);
                break;
            case "stable:start":
                process.stdout.write(`  ${CYAN}stable${R}     `);
                break;
            case "stable:end": {
                const timeout = event.timedOut ? ` ${RED}(timed out!)${R}` : "";
                process.stdout.write(`${GREEN}${event.ms}ms${R}${timeout}\n`);
                break;
            }
            case "waitForContent:start":
                process.stdout.write(`  ${CYAN}waitFor${R}    ${GRAY}${JSON.stringify(event.text)}${R} `);
                break;
            case "waitForContent:end": {
                const status = event.found ? `${GREEN}${event.ms}ms${R}` : `${RED}timeout after ${event.ms}ms${R}`;
                process.stdout.write(`${status}\n`);
                break;
            }
            case "assert:pass":
                process.stdout.write(`  ${GREEN}assert${R}     ${GRAY}${JSON.stringify(event.contains)}${R}\n`);
                break;
            case "snapshot":
                process.stdout.write("\n" + sep(`snapshot: ${event.name}`) + "\n");
                process.stdout.write(event.ansi + R + "\n");
                process.stdout.write(sep() + "\n\n");
                break;
            case "screenshot":
                process.stdout.write(`  ${CYAN}screenshot${R} ${GRAY}${event.name}${R} → ${event.path}\n`);
                break;
            case "profile":
                process.stdout.write(formatProfile(event.report) + "\n");
                break;
        }
    };
}

async function runAll(): Promise<void> {
    const json = flags.includes("--json");
    const filter = flagValue("--filter")?.split(",").filter(Boolean);
    const results = await runSuite({
        dir: flagValue("--dir"),
        filter,
        includePerf: flags.includes("--include-perf"),
        parallel: Number(flagValue("--parallel") ?? 2),
        updateGolden,
        screenshots: flags.includes("--screenshots"),
        timeoutMs: flagValue("--timeout") ? Number(flagValue("--timeout")) * 1000 : undefined,
        onResult: json ? undefined : printSuiteLine,
    });
    const failed = results.filter((r) => !r.ok);
    if (json) {
        process.stdout.write(JSON.stringify(results) + "\n");
    } else {
        for (const r of failed) {
            process.stdout.write("\n" + sep(`FAILED: ${r.name}`) + "\n" + (r.error ?? "") + "\n");
        }
        const passed = results.filter((r) => r.ok && !r.skipped).length;
        const skipped = results.filter((r) => r.skipped).length;
        process.stdout.write(
            `
${failed.length ? RED : GREEN}${passed} passed, ${failed.length} failed${R}${skipped ? `${GRAY}, ${skipped} skipped${R}` : ""}
`
        );
    }
    process.exit(failed.length > 0 ? 1 : 0);
}

function printSuiteLine(r: SuiteResult): void {
    const mark = r.skipped ? `${GRAY}-${R}` : r.ok ? `${GREEN}✓${R}` : `${RED}✗${R}`;
    const detail = r.skipped
        ? `${GRAY}${r.skipped}${R}`
        : r.ok
          ? `${GRAY}${(r.ms / 1000).toFixed(1)}s${R}`
          : `${RED}${(r.error ?? "").split("\n")[1] ?? (r.error ?? "").split("\n")[0]}${R}`;
    process.stdout.write(`  ${mark} ${r.name.padEnd(34)} ${detail}
`);
}

try {
    if (all) await runAll();
    const raw = readFileSync(scenarioPath!, "utf-8");
    const scenario = parseScenario(raw);

    if (!scenario.name) scenario.name = path.basename(scenarioPath!).replace(/\.json$/, "");
    if (profile || updateBaseline) {
        scenario.profile = { ...(scenario.profile ?? { enabled: true }), enabled: true };
        if (updateBaseline) scenario.profile.updateBaseline = true;
    }

    if (pretty) {
        process.stdout.write(sep(scenarioPath!, "─") + "\n\n");
        const result = await runScenario(scenario, { onEvent: makeLiveHandler(), updateGolden });
        printMetrics(result);
        // Exit once the output is flushed: a pseudo-terminal whose app quit by itself can keep Node alive on Windows.
        process.stdout.write("\n", () => process.exit(0));
    } else {
        const result = await runScenario(scenario, { updateGolden });
        process.stdout.write(JSON.stringify(result));
        process.stdout.write("\n", () => process.exit(0));
    }
} catch (err) {
    process.stderr.write(`${RED}Error:${R} ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
}
