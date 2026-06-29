import * as pty from "node-pty";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { TermEmulator } from "./termEmulator.ts";
import { resolveKey } from "./keyMap.ts";
import { renderToImageBrowser } from "./screenshotBrowser.ts";
import { renderToImagePowerShell } from "./screenshotPowerShell.ts";
import { analyzeProfileFile } from "./profiling/analyze.ts";
import type { InteractionMark } from "./profiling/types.ts";
import type { HarnessEvent, HarnessResult, RunOptions, Scenario, Snapshot } from "./types.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export async function runScenario(scenario: Scenario, options: RunOptions = {}): Promise<HarnessResult> {
    const emit = (event: HarnessEvent) => options.onEvent?.(event);
    const cols = scenario.terminal?.cols ?? 200;
    const rows = scenario.terminal?.rows ?? 50;

    const termEmulator = new TermEmulator(cols, rows);
    const snapshots: Record<string, Snapshot> = {};
    const metrics: Record<string, number | boolean> = {};

    // --- Profiling setup ---
    const profileCfg = scenario.profile?.enabled ? scenario.profile : undefined;
    const marks: InteractionMark[] = [];
    let interactionIdx = 0;
    const profileOut = profileCfg ? path.join(os.tmpdir(), "goblin-tui-test", `profile-${Date.now()}.jsonl`) : undefined;
    if (profileOut) {
        fs.mkdirSync(path.dirname(profileOut), { recursive: true });
        try {
            fs.rmSync(profileOut);
        } catch {
            /* fresh file */
        }
    }
    const markInteraction = (label: string): void => {
        if (profileCfg) marks.push({ index: interactionIdx++, label, t: Date.now() });
    };

    let rawBuffer = "";
    let lastSnapshotBoundary = 0;
    let lastDataTime = 0; // 0 means no data yet
    let totalBytesReceived = 0;
    // exitCode tracks natural exits only (crashes, explicit app quit).
    // If the harness kills the process after all steps are done, exitCode stays null.
    let stepsCompleted = false;
    let appExitCode: number | null = null;

    const isWin = process.platform === "win32";
    const shell = isWin ? (process.env["COMSPEC"] ?? "cmd.exe") : "/bin/sh";
    const shellFlag = isWin ? "/c" : "-c";

    const ptyEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
        if (v !== undefined) ptyEnv[k] = v;
    }
    const dataDirOverride = scenario.dataDir
        ? path.isAbsolute(scenario.dataDir)
            ? scenario.dataDir
            : path.resolve(ROOT, scenario.dataDir)
        : undefined;
    Object.assign(ptyEnv, scenario.env ?? {}, {
        TERM: "xterm-256color",
        FORCE_COLOR: "1",
        COLORTERM: "truecolor",
        GOBLIN_NO_AUDIO: "1",
        ...(dataDirOverride ? { GOBLIN_DATA_DIR: dataDirOverride } : {}),
        ...(profileOut ? { DEV: "true", GOBLIN_PROFILE_OUT: profileOut } : {}),
    });

    // Profile mode boots through the instrumented entry, which installs the
    // React devtools hook before Ink loads. Visual output is identical, so all
    // snapshot/assert steps still work.
    const command = profileCfg ? "yarn tsx src/profiling/profiledEntry.tsx" : "yarn dev";
    const ptyProcess = pty.spawn(shell, [shellFlag, command], {
        name: "xterm-256color",
        cols,
        rows,
        cwd: ROOT,
        env: ptyEnv,
    });

    ptyProcess.onData((data: string) => {
        lastDataTime = Date.now();
        totalBytesReceived += data.length;
        rawBuffer += data;
        termEmulator.feed(data);
    });

    ptyProcess.onExit(({ exitCode }) => {
        if (!stepsCompleted) {
            appExitCode = exitCode ?? null;
        }
    });

    // Resolves false=stable, true=timed out.
    // minBytes: don't declare stable until this many bytes have been received.
    // Default 1000: ConPTY init codes are ~16 bytes, tsx dotenv message ~200 bytes — both
    // are skipped. The app's first render is 50KB+, which crosses the threshold.
    function waitForStable(timeoutMs = 5000, quiescenceMs = 300, minBytes = 1000): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            const start = Date.now();
            function check() {
                const now = Date.now();
                const elapsed = now - start;
                const idle = lastDataTime > 0 ? now - lastDataTime : Infinity;
                const enoughData = totalBytesReceived >= minBytes;

                if (enoughData && idle >= quiescenceMs) {
                    resolve(false); // stable
                } else if (elapsed >= timeoutMs) {
                    resolve(true); // timed out
                } else {
                    setTimeout(check, Math.max(1, Math.min(50, timeoutMs - elapsed)));
                }
            }
            setTimeout(check, 10);
        });
    }

    async function takeSnapshot(name: string): Promise<void> {
        await termEmulator.flush();
        const plain = termEmulator.readScreen();
        const ansi = termEmulator.readScreenAnsi();
        const raw = rawBuffer.slice(lastSnapshotBoundary);
        lastSnapshotBoundary = rawBuffer.length;
        snapshots[name] = { raw, plain, ansi };
    }

    let stableIdx = 0;
    let lastSnapshotTime = Date.now();

    try {
        for (const step of scenario.steps) {
            switch (step.type) {
                case "key": {
                    // delayMs: gap after each press (default 100ms). Set lower to
                    // simulate held-key autorepeat (~30-50ms). repeat: send N times.
                    const keyDelay = step.delayMs ?? 100;
                    const repeat = step.repeat ?? 1;
                    for (let i = 0; i < repeat; i++) {
                        emit({ type: "key", key: step.key });
                        markInteraction(step.key);
                        ptyProcess.write(resolveKey(step.key));
                        await new Promise<void>((r) => setTimeout(r, keyDelay));
                    }
                    break;
                }

                case "type":
                    emit({ type: "type", text: step.text });
                    markInteraction(`type ${JSON.stringify(step.text)}`);
                    ptyProcess.write(step.text);
                    break;

                case "wait":
                    emit({ type: "wait", ms: step.ms });
                    await new Promise<void>((r) => setTimeout(r, step.ms));
                    break;

                case "stable": {
                    emit({ type: "stable:start" });
                    const start = Date.now();
                    const timedOut = await waitForStable(step.timeout, step.quiescenceMs, step.minBytes);
                    const ms = Date.now() - start;
                    emit({ type: "stable:end", ms, timedOut });
                    metrics[`stable_${stableIdx}_ms`] = ms;
                    if (timedOut) {
                        metrics[`stable_${stableIdx}_timed_out`] = true;
                        await takeSnapshot(`timeout_stable_${stableIdx}`);
                        const { plain, ansi } = snapshots[`timeout_stable_${stableIdx}`]!;
                        emit({ type: "snapshot", name: `timeout_stable_${stableIdx}`, plain, ansi });
                        throw new Error(`stable step ${stableIdx} timed out after ${ms}ms`);
                    }
                    stableIdx++;
                    break;
                }

                case "waitForContent": {
                    emit({ type: "waitForContent:start", text: step.text });
                    const timeoutMs = step.timeout ?? 10000;
                    const start = Date.now();
                    let found = false;
                    while (Date.now() - start < timeoutMs) {
                        await termEmulator.flush();
                        if (termEmulator.readScreen().includes(step.text)) { found = true; break; }
                        await new Promise<void>((r) => setTimeout(r, 100));
                    }
                    const ms = Date.now() - start;
                    emit({ type: "waitForContent:end", text: step.text, ms, found });
                    metrics[`waitForContent_${step.text}_ms`] = ms;
                    if (!found) {
                        metrics[`waitForContent_${step.text}_timeout`] = true;
                        const snapshotName = `timeout_waitForContent_${stableIdx}`;
                        await takeSnapshot(snapshotName);
                        const { plain, ansi } = snapshots[snapshotName]!;
                        emit({ type: "snapshot", name: snapshotName, plain, ansi });
                        throw new Error(`waitForContent "${step.text}" timed out after ${ms}ms`);
                    }
                    break;
                }

                case "assert": {
                    await termEmulator.flush();
                    if (!termEmulator.readScreen().includes(step.contains)) {
                        const snapshotName = `assert_fail`;
                        await takeSnapshot(snapshotName);
                        const { plain, ansi } = snapshots[snapshotName]!;
                        emit({ type: "snapshot", name: snapshotName, plain, ansi });
                        throw new Error(`assert failed: screen does not contain "${step.contains}"`);
                    }
                    emit({ type: "assert:pass", contains: step.contains });
                    break;
                }

                case "snapshot": {
                    await takeSnapshot(step.name);
                    const { plain, ansi } = snapshots[step.name]!;
                    emit({ type: "snapshot", name: step.name, plain, ansi });
                    metrics[`snapshot_${step.name}_ms`] = Date.now() - lastSnapshotTime;
                    lastSnapshotTime = Date.now();
                    break;
                }

                case "screenshot": {
                    await termEmulator.flush();
                    const imgPath = path.join(os.tmpdir(), "goblin-tui-test", `${step.name}.png`);
                    await termEmulator.renderToImage(imgPath);
                    emit({ type: "screenshot", name: step.name, path: imgPath });
                    break;
                }

                case "screenshot-browser": {
                    await termEmulator.flush();
                    const imgPath = path.join(os.tmpdir(), "goblin-tui-test", `${step.name}.png`);
                    await renderToImageBrowser(termEmulator.cols, termEmulator.rows, rawBuffer, imgPath);
                    emit({ type: "screenshot", name: step.name, path: imgPath });
                    break;
                }

                case "screenshot-powershell": {
                    await termEmulator.flush();
                    const imgPath = path.join(os.tmpdir(), "goblin-tui-test", `${step.name}.png`);
                    await renderToImagePowerShell(termEmulator.cols, termEmulator.rows, termEmulator.readScreenAnsi(), imgPath);
                    emit({ type: "screenshot", name: step.name, path: imgPath });
                    break;
                }
            }
        }
        stepsCompleted = true;
    } finally {
        if (appExitCode === null) {
            try { ptyProcess.kill(); } catch {}
        }
        // Allow time for the exit event to fire
        await new Promise<void>((r) => setTimeout(r, 300));
    }

    const result: HarnessResult = { snapshots, metrics, exitCode: appExitCode };

    if (profileCfg && profileOut) {
        // Records are written synchronously per commit, so the file is complete
        // by the time the process is gone. Bucket commits against interaction marks.
        const report = analyzeProfileFile(profileOut, {
            marks,
            thresholds: profileCfg.thresholds,
            scenario: scenario.name,
            updateBaseline: profileCfg.updateBaseline,
        });
        result.profile = report;
        emit({ type: "profile", report });
    }

    return result;
}
