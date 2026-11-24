/**
 * Interactive sessions: one app kept running between commands, so you press a key, read the screen and decide.
 *
 *   yarn tsx scripts/tui-test/sessionCli.ts start --data-dir scripts/tui-test/fixtures/50-tasks-with-metadata
 *   yarn tsx scripts/tui-test/sessionCli.ts key Down Down Enter
 *   yarn tsx scripts/tui-test/sessionCli.ts click "Settings"
 *   yarn tsx scripts/tui-test/sessionCli.ts find "Settings"
 *   yarn tsx scripts/tui-test/sessionCli.ts stop
 *
 * Every action prints the screen it ended on, with row numbers (the first column of the screen is column 1).
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { parseScenario } from "./parseScenario.ts";
import { ROOT } from "./session.ts";
import { SESSIONS_DIR, type SessionRecord } from "./sessionShared.ts";
import type { Scenario, Step } from "./types.ts";

const HELP = `Interactive TUI sessions

  start [--name n] [--scenario file.json] [--data-dir dir] [--cols N] [--rows N] [--set a.b=json ...]
        Starts the app (default name "default"). --scenario takes everything but the steps (terminal, dataDir,
        settings, network, scale, env); the other options override it. --set patches settings.json
        (e.g. --set music.download.outputDir='"x"').
  key <key...>            Presses keys ("Down", "Ctrl+Q", "Alt+x"...), then waits for the screen to settle.
  type <text>             Types text (one paste).
  click <col> <row> | click <text>   Left click on a cell, or on the first place the text is on the screen.
  step '<json>'           Runs one step of the scenario format (any of them); steps '<json array>' runs several.
  screen [--ansi]         Prints the screen again.
  find <text> [--regex]   Where the text is on the screen (row, column, width).
  status                  Shows the running sessions.   stop [--all]   Stops one (or all).

Options for every command: --name n (default "default"), --quiet (no screen), --no-settle (do not wait after the action).
`;

const args = process.argv.slice(2);

function takeFlag(name: string): boolean {
    const i = args.indexOf(name);
    if (i < 0) return false;
    args.splice(i, 1);
    return true;
}
function takeOption(name: string): string | undefined {
    const i = args.indexOf(name);
    if (i < 0) return undefined;
    const value = args[i + 1];
    args.splice(i, 2);
    return value;
}
function takeOptions(name: string): string[] {
    const values: string[] = [];
    for (let v = takeOption(name); v !== undefined; v = takeOption(name)) values.push(v);
    return values;
}

const name = takeOption("--name") ?? "default";
const quiet = takeFlag("--quiet");
const noSettle = takeFlag("--no-settle");
// Options may come before or after the command.
const command = args.shift();
const recordFile = (n: string): string => path.join(SESSIONS_DIR, `${n}.json`);

function readRecord(n: string): SessionRecord {
    try {
        return JSON.parse(fs.readFileSync(recordFile(n), "utf-8")) as SessionRecord;
    } catch {
        throw new Error(`No running session "${n}". Start one with: sessionCli.ts start [--name ${n}]`);
    }
}

interface Reply {
    ok: boolean;
    error?: string;
    screen?: string;
    cols?: number;
    rows?: number;
    cursor?: { col: number; row: number };
    exited?: boolean;
    exitCode?: number | null;
    found?: Array<{ row: number; col: number; width: number; text: string }>;
}

async function call(method: "GET" | "POST", endpoint: string, body?: unknown): Promise<Reply> {
    const rec = readRecord(name);
    try {
        const response = await fetch(`http://127.0.0.1:${rec.port}${endpoint}`, {
            method,
            headers: { "x-token": rec.token, "content-type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        return (await response.json()) as Reply;
    } catch {
        // The server is gone (stopped by something else): its record is stale.
        fs.rmSync(recordFile(name), { force: true });
        throw new Error(`Session "${name}" is not running any more.`);
    }
}

function printScreen(reply: Reply): void {
    const lines = (reply.screen ?? "").split("\n");
    const width = String(lines.length).length;
    const header = `── ${reply.cols}x${reply.rows}${reply.cursor ? `, cursor at col ${reply.cursor.col} row ${reply.cursor.row}` : ""}${
        reply.exited ? `, APP EXITED (code ${reply.exitCode})` : ""
    } ──`;
    process.stdout.write(header + "\n");
    process.stdout.write(lines.map((l, i) => `${String(i + 1).padStart(width)}│${l}`).join("\n") + "\n");
}

async function act(steps: Step[]): Promise<void> {
    const reply = await call("POST", "/steps", { steps, settle: !noSettle });
    if (!quiet) printScreen(reply);
    if (!reply.ok) {
        process.stderr.write(`\nFAILED: ${reply.error}\n`);
        process.exitCode = 1;
    }
}

async function start(): Promise<void> {
    if (fs.existsSync(recordFile(name))) {
        try {
            await call("GET", "/screen");
            throw new Error(`Session "${name}" is already running: stop it first or pick another --name`);
        } catch (error) {
            if (error instanceof Error && error.message.includes("already running")) throw error;
        }
    }
    let scenario: Scenario = { steps: [] };
    const scenarioFile = takeOption("--scenario");
    if (scenarioFile) scenario = parseScenario(fs.readFileSync(scenarioFile, "utf-8"));
    scenario.steps = [];
    const dataDir = takeOption("--data-dir");
    if (dataDir) scenario.dataDir = dataDir;
    const cols = takeOption("--cols");
    const rows = takeOption("--rows");
    if (cols || rows) {
        scenario.terminal = {
            cols: cols ? Number(cols) : (scenario.terminal?.cols ?? 160),
            rows: rows ? Number(rows) : (scenario.terminal?.rows ?? 45),
        };
    } else {
        scenario.terminal ??= { cols: 160, rows: 45 };
    }
    for (const assignment of takeOptions("--set")) {
        const eq = assignment.indexOf("=");
        if (eq < 0) throw new Error(`--set needs path=json, got "${assignment}"`);
        const keys = assignment.slice(0, eq).split(".");
        let value: unknown;
        const raw = assignment.slice(eq + 1);
        try {
            value = JSON.parse(raw);
        } catch {
            value = raw;
        }
        scenario.settings ??= {};
        let target = scenario.settings as Record<string, unknown>;
        for (const key of keys.slice(0, -1)) {
            const next = target[key];
            target = (typeof next === "object" && next !== null ? next : (target[key] = {})) as Record<string, unknown>;
        }
        target[keys.at(-1)!] = value;
    }
    // A relative data folder is relative to the repository, like in a scenario.
    if (
        scenario.dataDir &&
        !path.isAbsolute(scenario.dataDir) &&
        !fs.existsSync(path.resolve(ROOT, scenario.dataDir))
    ) {
        scenario.dataDir = path.resolve(process.cwd(), scenario.dataDir);
    }

    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    const config = path.join(SESSIONS_DIR, `${name}.config.json`);
    fs.writeFileSync(config, JSON.stringify({ name, scenario }));
    const logFile = path.join(SESSIONS_DIR, `${name}.log`);
    const fd = fs.openSync(logFile, "w");
    const child = spawn(
        process.execPath,
        ["--import", "tsx", path.join(import.meta.dirname, "sessionServer.ts"), config],
        {
            cwd: ROOT,
            detached: true,
            stdio: ["ignore", fd, fd],
            windowsHide: true,
        }
    );
    child.unref();

    const deadline = Date.now() + 90_000;
    while (!fs.existsSync(recordFile(name))) {
        if (Date.now() > deadline || child.exitCode !== null) {
            const log = fs.readFileSync(logFile, "utf-8").slice(-2000);
            throw new Error(`The session did not start.\n${log}`);
        }
        await new Promise((r) => setTimeout(r, 200));
    }
    process.stdout.write(`Session "${name}" started.\n`);
    if (!quiet) printScreen(await call("GET", "/screen"));
}

async function stop(): Promise<void> {
    const names = takeFlag("--all")
        ? fs.existsSync(SESSIONS_DIR)
            ? fs
                  .readdirSync(SESSIONS_DIR)
                  .filter((f) => f.endsWith(".json") && !f.endsWith(".config.json"))
                  .map((f) => f.replace(/\.json$/, ""))
            : []
        : [name];
    for (const n of names) {
        try {
            const rec = readRecord(n);
            await fetch(`http://127.0.0.1:${rec.port}/stop`, { method: "POST", headers: { "x-token": rec.token } });
            process.stdout.write(`Session "${n}" stopped.\n`);
        } catch {
            fs.rmSync(recordFile(n), { force: true });
            process.stdout.write(`Session "${n}" was not running.\n`);
        }
    }
}

try {
    switch (command) {
        case "start":
            await start();
            break;
        case "key":
            if (args.length === 0) throw new Error("key needs at least one key name");
            await act(args.map((key) => ({ type: "key", key }) as Step));
            break;
        case "type":
            await act([{ type: "type", text: args.join(" ") }]);
            break;
        case "click": {
            const [a, b] = args;
            if (a !== undefined && b !== undefined && /^\d+$/.test(a) && /^\d+$/.test(b)) {
                await act([{ type: "click", col: Number(a), row: Number(b) }]);
            } else {
                await act([{ type: "click", text: args.join(" ") }]);
            }
            break;
        }
        case "step":
            await act([JSON.parse(args.join(" ")) as Step]);
            break;
        case "steps":
            await act(JSON.parse(args.join(" ")) as Step[]);
            break;
        case "screen": {
            if (takeFlag("--ansi")) {
                process.stdout.write(((await call("GET", "/ansi")).screen ?? "") + "\x1b[0m\n");
            } else {
                printScreen(await call("GET", "/screen"));
            }
            break;
        }
        case "find": {
            const regex = takeFlag("--regex");
            const text = args.join(" ");
            const reply = await call("POST", "/find", regex ? { matches: text } : { contains: text });
            if (!reply.found?.length) {
                process.stdout.write(`${JSON.stringify(text)}: not on the screen\n`);
                process.exitCode = 1;
            }
            for (const f of reply.found ?? []) {
                process.stdout.write(`row ${f.row}, col ${f.col}, width ${f.width}: ${JSON.stringify(f.text)}\n`);
            }
            break;
        }
        case "status": {
            const files = fs.existsSync(SESSIONS_DIR)
                ? fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith(".json") && !f.endsWith(".config.json"))
                : [];
            if (files.length === 0) process.stdout.write("No session running.\n");
            for (const f of files) {
                const rec = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), "utf-8")) as SessionRecord;
                process.stdout.write(
                    `${rec.name}  pid ${rec.pid}  port ${rec.port}  up ${Math.round((Date.now() - rec.startedAt) / 1000)}s\n`
                );
            }
            break;
        }
        case "stop":
            await stop();
            break;
        default:
            process.stdout.write(HELP);
            if (command && command !== "help") process.exitCode = 1;
    }
} catch (error) {
    process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
}
