import { readFileSync } from "node:fs";
import { runScenario } from "./runner.ts";
import type { HarnessEvent, HarnessResult, Scenario } from "./types.ts";

const [, , scenarioPath, ...flags] = process.argv;
const pretty = flags.includes("--pretty");

if (!scenarioPath) {
    process.stderr.write("Usage: tsx scripts/tui-test/cli.ts <scenario.json> [--pretty]\n");
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
    const codeStr = code === null ? `${GREEN}null${R}${GRAY} (clean harness kill)${R}` : `${RED}${code}${R}`;
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
        }
    };
}

try {
    const raw = readFileSync(scenarioPath, "utf-8");
    const scenario = JSON.parse(raw) as Scenario;

    if (pretty) {
        process.stdout.write(sep(scenarioPath, "─") + "\n\n");
        const result = await runScenario(scenario, { onEvent: makeLiveHandler() });
        printMetrics(result);
        process.stdout.write("\n");
    } else {
        const result = await runScenario(scenario);
        process.stdout.write(JSON.stringify(result));
        process.stdout.write("\n");
    }
} catch (err) {
    process.stderr.write(`${RED}Error:${R} ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
}
