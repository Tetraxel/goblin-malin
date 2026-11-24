import * as pty from "node-pty";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TermEmulator } from "./termEmulator.ts";
import { createIsolatedDataDir, DEFAULT_FIXTURE, type IsolatedDataDir } from "./isolatedDataDir.ts";
import { scaleSessionsFile } from "./scaleFixture.ts";
import type { NetworkConfig, Scenario, Snapshot } from "./types.ts";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PRELOAD_FAKE_NETWORK = path.join(path.dirname(fileURLToPath(import.meta.url)), "preload", "fakeNetwork.mjs");

export interface LogEntry {
    level: string;
    message: string;
    raw: string;
}

export interface RequestEntry {
    t: number;
    method: string;
    url: string;
    outcome: "stub" | "offline" | "passthrough" | "error";
    status?: number;
}

const LEVEL_RANK: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };
export const levelRank = (level: string): number => LEVEL_RANK[level.toLowerCase()] ?? 1;

/**
 * A running copy of the app inside a pseudo-terminal, with a headless terminal emulator reading its screen. It owns
 * everything a run needs and nothing about what to do with it: the scenario runner (`runner.ts`) and the interactive
 * session server (`sessionServer.ts`) both drive one.
 */
export class TuiSession {
    readonly emulator: TermEmulator;
    /** The throwaway data folder the app runs on (`GOBLIN_DATA_DIR`). */
    readonly dataDir: string;
    /** Where the profiled app writes its records, when profiling is on. */
    readonly profileOut?: string;
    /** The file the profiled app polls for `startLoad` / `stopLoad`. */
    readonly loadControl?: string;
    rawBuffer = "";
    totalBytesReceived = 0;
    lastDataTime = 0; // 0: no data yet
    /** What was sent to the app (keys, text, mouse), oldest first: shown when a step fails. */
    readonly inputs: string[] = [];
    /** The exit code, once the app has exited by itself (or been killed by something else than `dispose`). */
    appExitCode: number | null = null;
    exited = false;

    private readonly ptyProcess: pty.IPty;
    private readonly isolated: IsolatedDataDir;
    private readonly keepDataDir: boolean;
    private readonly exitWaiters: Array<() => void> = [];
    private disposing = false;
    private lastSnapshotBoundary = 0;
    private readonly networkRules?: string;
    /** The file that stands in for the system clipboard (`GOBLIN_TEST_CLIPBOARD`, see src/base/systemClipboard.ts). */
    readonly clipboardFile: string;
    private readonly networkLog?: string;

    constructor(scenario: Scenario) {
        const cols = scenario.terminal?.cols ?? 200;
        const rows = scenario.terminal?.rows ?? 50;
        this.emulator = new TermEmulator(cols, rows);

        const profileCfg = scenario.profile?.enabled ? scenario.profile : undefined;
        const runId = `${Date.now()}-${process.pid}-${Math.floor(Math.random() * 1e4)}`;
        if (profileCfg) {
            this.profileOut = path.join(os.tmpdir(), "goblin-tui-test", `profile-${runId}.jsonl`);
            this.loadControl = path.join(os.tmpdir(), "goblin-tui-test", `load-${runId}.json`);
            fs.mkdirSync(path.dirname(this.profileOut), { recursive: true });
            fs.rmSync(this.profileOut, { force: true });
        }

        const isWin = process.platform === "win32";
        const shell = isWin ? (process.env["COMSPEC"] ?? "cmd.exe") : "/bin/sh";
        const shellFlag = isWin ? "/c" : "-c";

        const ptyEnv: Record<string, string> = {};
        for (const [k, v] of Object.entries(process.env)) {
            if (v !== undefined) ptyEnv[k] = v;
        }
        // The app runs in a real terminal here, like a user's. On a CI runner (`CI=true`), Ink would otherwise think it
        // is not interactive and draw nothing until it exits (`is-in-ci`), so every scenario would time out.
        delete ptyEnv["CI"];
        delete ptyEnv["CONTINUOUS_INTEGRATION"];
        // The app always runs on a throwaway copy of the fixture, never on the fixture itself (see isolatedDataDir.ts).
        const fixtureDir = path.resolve(ROOT, scenario.dataDir ?? DEFAULT_FIXTURE);
        this.isolated = createIsolatedDataDir(fixtureDir, scenario.settings);
        this.dataDir = this.isolated.dir;
        if (scenario.scale) scaleSessionsFile(this.dataDir, scenario.scale);
        this.keepDataDir = !!process.env["GOBLIN_TUI_KEEP_DATA"];
        if (this.keepDataDir) console.error(`[tui-test] data folder kept at ${this.dataDir}`);
        // The app never touches the developer's clipboard: a file of the data folder stands in for it.
        this.clipboardFile = path.join(this.dataDir, ".tui-test", "clipboard.txt");
        fs.mkdirSync(path.dirname(this.clipboardFile), { recursive: true });
        fs.writeFileSync(this.clipboardFile, scenario.clipboard ?? "");
        const slowMode = !!(process.env["GOBLIN_SLOW"] ?? scenario.env?.["GOBLIN_SLOW"]);

        // The fake network: a preload that replaces `fetch`, a rules file the harness rewrites, a log it reads.
        const networkEnv: Record<string, string> = {};
        if (scenario.network) {
            const dir = path.join(this.dataDir, ".tui-test");
            fs.mkdirSync(dir, { recursive: true });
            this.networkRules = path.join(dir, "network-rules.json");
            this.networkLog = path.join(dir, "network-log.jsonl");
            fs.writeFileSync(this.networkLog, "");
            this.setNetwork(scenario.network);
            const existing = ptyEnv["NODE_OPTIONS"] ?? "";
            Object.assign(networkEnv, {
                NODE_OPTIONS: `${existing} --import ${pathToFileURL(PRELOAD_FAKE_NETWORK).href}`.trim(),
                GOBLIN_TEST_NETWORK_RULES: this.networkRules,
                GOBLIN_TEST_NETWORK_LOG: this.networkLog,
            });
        }

        // Truecolor (`FORCE_COLOR=3`) like Windows Terminal, iTerm2 and most Linux terminals give the app: 16 colours
        // would make every frame ~30 % shorter than a user's. A scenario can still ask for another level in its `env`.
        Object.assign(ptyEnv, { FORCE_COLOR: "3" }, scenario.env ?? {}, networkEnv, {
            TERM: "xterm-256color",
            COLORTERM: "truecolor",
            GOBLIN_NO_AUDIO: "1",
            GOBLIN_TEST_CLIPBOARD: this.clipboardFile,
            GOBLIN_DATA_DIR: this.dataDir,
            ...(this.profileOut ? { DEV: "true", GOBLIN_PROFILE_OUT: this.profileOut } : {}),
            // The build users run (`profile.build: "production"`): see ProfileConfig.build.
            ...(profileCfg?.build === "production" ? { NODE_ENV: "production" } : {}),
            ...(this.loadControl ? { GOBLIN_PROFILE_CONTROL: this.loadControl } : {}),
        });

        // Profile mode boots through the instrumented entry, which installs the React devtools hook before Ink loads.
        // `scenario.command` runs something else (e.g. `node dist/cli.js` to time the shipped bundle).
        const command = scenario.command ?? (profileCfg ? "yarn tsx src/profiling/profiledEntry.tsx" : "yarn dev");
        this.ptyProcess = pty.spawn(shell, [shellFlag, command], {
            name: "xterm-256color",
            cols,
            rows,
            cwd: ROOT,
            env: ptyEnv,
        });

        // GOBLIN_SLOW: constrain the PTY process to simulate slow/low-end hardware. Idle CPU priority + single-core
        // affinity, inherited by the child processes (cmd → yarn → node), so the whole app runs under constraint.
        if (slowMode) {
            try {
                os.setPriority(this.ptyProcess.pid, os.constants.priority.PRIORITY_LOW);
            } catch {
                /* best effort */
            }
            if (process.platform === "win32") {
                spawnSync("powershell.exe", [
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    `(Get-Process -Id ${this.ptyProcess.pid}).ProcessorAffinity = 1`,
                ]);
            }
        }

        this.ptyProcess.onData((data: string) => {
            this.lastDataTime = Date.now();
            this.totalBytesReceived += data.length;
            this.rawBuffer += data;
            this.emulator.feed(data);
        });
        this.ptyProcess.onExit(({ exitCode }) => {
            this.exited = true;
            // Our own kill (in `dispose`) is not the app's exit.
            if (!this.disposing) this.appExitCode = exitCode ?? null;
            for (const wake of this.exitWaiters.splice(0)) wake();
        });
    }

    get cols(): number {
        return this.emulator.cols;
    }
    get rows(): number {
        return this.emulator.rows;
    }

    /** Sends bytes to the app. `label` is what a failure report shows for them. */
    write(data: string, label?: string): void {
        this.inputs.push(label ?? JSON.stringify(data));
        if (this.inputs.length > 200) this.inputs.shift();
        this.ptyProcess.write(data);
    }

    /** Resizes the terminal the app runs in and the emulator that reads it. */
    resize(cols: number, rows: number): void {
        this.emulator.resize(cols, rows);
        this.ptyProcess.resize(cols, rows);
    }

    /**
     * Resolves false = stable, true = timed out. `minBytes`: don't declare stable until this many bytes were received.
     * Default 1000: ConPTY init codes are ~16 bytes, tsx's dotenv message ~200 — both are skipped. The app's first
     * render is 50KB+, which crosses the threshold.
     */
    waitForStable(timeoutMs = 5000, quiescenceMs = 300, minBytes = 1000): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            const start = Date.now();
            const check = (): void => {
                const now = Date.now();
                const elapsed = now - start;
                // Quiet time counts from the start of the wait at the earliest: output from before a key press is
                // not an answer to it, and the app may not have started repainting yet.
                const idle = this.lastDataTime > 0 ? now - Math.max(this.lastDataTime, start) : Infinity;
                if (this.totalBytesReceived >= minBytes && idle >= quiescenceMs) resolve(false);
                else if (elapsed >= timeoutMs) resolve(true);
                else setTimeout(check, Math.max(1, Math.min(50, timeoutMs - elapsed)));
            };
            setTimeout(check, 10);
        });
    }

    /** The screen as plain text, once everything the app wrote so far is on it. */
    async readScreen(): Promise<string> {
        await this.emulator.flush();
        return this.emulator.readScreen();
    }

    async takeSnapshot(): Promise<Snapshot> {
        await this.emulator.flush();
        const plain = this.emulator.readScreen();
        const ansi = this.emulator.readScreenAnsi();
        const raw = this.rawBuffer.slice(this.lastSnapshotBoundary);
        this.lastSnapshotBoundary = this.rawBuffer.length;
        return { raw, plain, ansi };
    }

    /** Resolves true when the app has exited, false when `timeoutMs` ran out first. */
    waitForExit(timeoutMs: number): Promise<boolean> {
        if (this.exited) return Promise.resolve(true);
        return new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => resolve(false), timeoutMs);
            this.exitWaiters.push(() => {
                clearTimeout(timer);
                resolve(true);
            });
        });
    }

    /** A path inside the data folder; refuses one that leaves it. */
    resolveDataPath(relative: string): string {
        const full = path.resolve(this.dataDir, relative);
        if (full !== this.dataDir && !full.startsWith(this.dataDir + path.sep)) {
            throw new Error(`"${relative}" is outside the app's data folder`);
        }
        return full;
    }

    /** The lines of `app.log` (JSON lines; a line that is not JSON counts as an `info` line). */
    readLog(): LogEntry[] {
        let text: string;
        try {
            text = fs.readFileSync(path.join(this.dataDir, "app.log"), "utf-8");
        } catch {
            return [];
        }
        const out: LogEntry[] = [];
        for (const line of text.split("\n")) {
            if (!line.trim()) continue;
            try {
                const parsed = JSON.parse(line) as { level?: unknown; message?: unknown };
                out.push({ level: String(parsed.level ?? "info"), message: String(parsed.message ?? ""), raw: line });
            } catch {
                out.push({ level: "info", message: line, raw: line });
            }
        }
        return out;
    }

    /** The requests the app made through the fake network, oldest first. */
    readRequests(): RequestEntry[] {
        if (!this.networkLog) return [];
        let text: string;
        try {
            text = fs.readFileSync(this.networkLog, "utf-8");
        } catch {
            return [];
        }
        const out: RequestEntry[] = [];
        for (const line of text.split("\n")) {
            if (!line.trim()) continue;
            try {
                out.push(JSON.parse(line) as RequestEntry);
            } catch {
                /* a half-written line: the next read has it */
            }
        }
        return out;
    }

    get hasNetwork(): boolean {
        return this.networkRules !== undefined;
    }

    /** Replaces the fake network's rules (the app reads the file on every request). */
    setNetwork(config: NetworkConfig): void {
        if (!this.networkRules) throw new Error("This scenario has no fake network: add a `network` section to it");
        const tmp = this.networkRules + ".tmp";
        fs.writeFileSync(tmp, JSON.stringify({ mode: config.mode ?? "offline", rules: config.rules ?? [] }));
        fs.renameSync(tmp, this.networkRules);
    }

    /** The network section as it is now, for `network` steps that append to it. */
    currentNetwork(): NetworkConfig {
        if (!this.networkRules) return {};
        try {
            return JSON.parse(fs.readFileSync(this.networkRules, "utf-8")) as NetworkConfig;
        } catch {
            return {};
        }
    }

    /** Stops the app (when it is still running), waits for it to go and removes the data folder. */
    async dispose(): Promise<void> {
        this.disposing = true;
        // After a natural exit there is nothing to kill (node-pty's console agent fails on a dead shell). On Windows
        // the pseudo-terminal's handles then keep a long-lived process (the CLI) alive: it exits explicitly.
        if (!this.exited) {
            try {
                this.ptyProcess.kill();
            } catch {
                /* already gone */
            }
        }
        // Allow time for the exit event to fire
        await new Promise<void>((r) => setTimeout(r, 300));
        if (!this.keepDataDir) this.isolated.dispose();
    }
}
