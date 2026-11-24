import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveKey, bracketedPaste } from "./keyMap.ts";
import { renderToImageBrowser } from "./screenshotBrowser.ts";
import { renderToImagePowerShell } from "./screenshotPowerShell.ts";
import {
    countMatches,
    describeMatch,
    findAll,
    lineDiff,
    maskText,
    regionText,
    styleMismatch,
    type Line,
    type Location,
    type TextMatch,
} from "./matchers.ts";
import { checkJsonValue, getPath, stripBom, type JsonExpectation } from "./jsonPath.ts";
import { mouseDrag, mouseMove, mousePress, mouseRelease, mouseWheel, type Point } from "./mouse.ts";
import { levelRank, ROOT, type TuiSession } from "./session.ts";
import type { HarnessEvent, MouseTarget, Scenario, Snapshot, Step } from "./types.ts";

/** Everything a step needs besides the app: where its output goes and what the scenario around it is. */
export interface StepRunnerOptions {
    scenario: Scenario;
    emit: (event: HarnessEvent) => void;
    /** Called for what a profiling bucket starts at (a key, a click, a resize…). */
    markInteraction?: (label: string) => void;
    goldenDir?: string;
    updateGolden?: boolean;
}

/** How long a state assertion (file, JSON, log, request) waits for the app to get there: it saves a moment later. */
const STATE_WAIT_MS = 3000;
const sleep = (ms: number): Promise<void> => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Runs one step against a session. The scenario runner calls it for every step of a file; the interactive session
 * server calls it for what Claude sends. Failures throw (with a snapshot of the screen emitted first).
 */
export class StepRunner {
    readonly snapshots: Record<string, Snapshot> = {};
    readonly metrics: Record<string, number | boolean> = {};
    private stableIdx = 0;
    private lastSnapshotTime = Date.now();

    constructor(
        readonly session: TuiSession,
        private readonly options: StepRunnerOptions
    ) {}

    private emit(event: HarnessEvent): void {
        this.options.emit(event);
    }

    private mark(label: string): void {
        this.options.markInteraction?.(label);
    }

    private info(step: string, detail: string): void {
        this.emit({ type: "step", step, detail });
    }

    /** Snapshots the screen under `name`, shows it, and throws `message`. */
    private async fail(snapshotName: string, message: string): Promise<never> {
        await this.snapshot(snapshotName);
        throw new Error(message);
    }

    private async snapshot(name: string, given?: Snapshot): Promise<Snapshot> {
        const taken = given ?? (await this.session.takeSnapshot());
        this.snapshots[name] = taken;
        this.emit({ type: "snapshot", name, plain: taken.plain, ansi: taken.ansi });
        return taken;
    }

    private async lines(): Promise<Line[]> {
        await this.session.emulator.flush();
        return this.session.emulator.readLines();
    }

    /** `text` is the older spelling of `contains`. */
    private matchOf(step: TextMatch & { text?: string }): TextMatch {
        const { text, contains, matches, flags, row, region } = step;
        return { contains: contains ?? text, matches, flags, row, region };
    }

    /** Where a mouse target is, 1-based (clamped to the screen). */
    private async point(target: MouseTarget): Promise<Point> {
        if ("col" in target) return { col: target.col, row: target.row };
        const match: TextMatch =
            "text" in target ? { contains: target.text } : { matches: target.matches, flags: target.flags };
        const found = findAll(await this.lines(), match);
        const nth = target.occurrence ?? 1;
        const at = found[nth - 1];
        if (!at) {
            await this.fail(
                "click_target_missing",
                `Nothing to point at: ${describeMatch(match)} is not on the screen`
            );
        }
        const hit = at as Location;
        const offset = target.offset ?? Math.floor((hit.width - 1) / 2);
        return {
            col: Math.min(this.session.cols, hit.col + offset),
            row: Math.min(this.session.rows, hit.row),
        };
    }

    /**
     * Retries `check` (which returns "" when satisfied, else why not) until it is, or `timeoutMs` ran out; then throws.
     */
    private async until(check: () => string, timeoutMs: number, what: string): Promise<void> {
        const start = Date.now();
        let why = check();
        while (why !== "" && Date.now() - start < timeoutMs) {
            await sleep(100);
            why = check();
        }
        if (why !== "") await this.fail("assert_fail", `${what}: ${why}`);
    }

    private countProblem(count: number, want: { count?: number; min?: number; max?: number }, what: string): string {
        if (want.count !== undefined)
            return count === want.count ? "" : `${what}: found ${count}, wanted exactly ${want.count}`;
        const min = want.min ?? (want.max === undefined ? 1 : 0);
        if (count < min) return `${what}: found ${count}, wanted at least ${min}`;
        if (want.max !== undefined && count > want.max) return `${what}: found ${count}, wanted at most ${want.max}`;
        return "";
    }

    async run(step: Step): Promise<void> {
        const { session } = this;
        switch (step.type) {
            case "key": {
                // delayMs: gap after each press (default 100ms). Set lower to simulate held-key autorepeat
                // (~30-50ms). repeat: send N times.
                const keyDelay = step.delayMs ?? 100;
                const repeat = step.repeat ?? 1;
                for (let i = 0; i < repeat; i++) {
                    this.emit({ type: "key", key: step.key });
                    this.mark(step.key);
                    session.write(resolveKey(step.key), step.key);
                    await sleep(keyDelay);
                }
                return;
            }

            // Both wait like a key does afterwards (100 ms by default): a key sent at once would reach the app in the
            // same chunk as the text, and be read as part of it (an Enter that confirms nothing).
            case "type":
                this.emit({ type: "type", text: step.text });
                this.mark(`type ${JSON.stringify(step.text)}`);
                session.write(step.text);
                await sleep(step.delayMs ?? 100);
                return;

            case "paste":
                this.info("paste", JSON.stringify(step.text));
                this.mark(`paste ${JSON.stringify(step.text)}`);
                session.write(
                    step.bracketed ? bracketedPaste(step.text) : step.text,
                    `paste ${JSON.stringify(step.text)}`
                );
                await sleep(step.delayMs ?? 100);
                return;

            case "wait":
                this.emit({ type: "wait", ms: step.ms });
                await sleep(step.ms);
                return;

            case "stable": {
                this.emit({ type: "stable:start" });
                const start = Date.now();
                const timedOut = await session.waitForStable(step.timeout, step.quiescenceMs, step.minBytes);
                const ms = Date.now() - start;
                this.emit({ type: "stable:end", ms, timedOut });
                this.metrics[`stable_${this.stableIdx}_ms`] = ms;
                if (timedOut) {
                    this.metrics[`stable_${this.stableIdx}_timed_out`] = true;
                    const taken = await this.snapshot(`timeout_stable_${this.stableIdx}`);
                    // What the app showed, so a failure on CI (where nobody sees the terminal) can be read.
                    const screen = taken.plain.replace(/\s+$/, "");
                    const raw = session.rawBuffer.slice(-2000).split("\u001b").join("\\e");
                    throw new Error(
                        `stable step ${this.stableIdx} timed out after ${ms}ms ` +
                            `(${session.totalBytesReceived} bytes received, exit code ${session.appExitCode ?? "none"})\n` +
                            `--- screen ---\n${screen || "(empty)"}\n--- last raw output ---\n${raw || "(none)"}`
                    );
                }
                this.stableIdx++;
                return;
            }

            case "waitForContent": {
                const match = this.matchOf(step);
                const label = step.text ?? step.contains ?? describeMatch(match);
                this.emit({ type: "waitForContent:start", text: label });
                const timeoutMs = step.timeout ?? 10000;
                const start = Date.now();
                let found = false;
                while (Date.now() - start < timeoutMs) {
                    if (countMatches(await this.lines(), match) > 0) {
                        found = true;
                        break;
                    }
                    await sleep(100);
                }
                const ms = Date.now() - start;
                this.emit({ type: "waitForContent:end", text: label, ms, found });
                this.metrics[`waitForContent_${label}_ms`] = ms;
                if (!found) {
                    this.metrics[`waitForContent_${label}_timeout`] = true;
                    await this.fail(
                        `timeout_waitForContent_${this.stableIdx}`,
                        `waitForContent ${label} timed out after ${ms}ms`
                    );
                }
                return;
            }

            case "waitForGone": {
                const match = this.matchOf(step);
                const label = step.text ?? step.contains ?? describeMatch(match);
                this.emit({ type: "waitForContent:start", text: `gone: ${label}` });
                const timeoutMs = step.timeout ?? 10000;
                const start = Date.now();
                let gone = false;
                while (Date.now() - start < timeoutMs) {
                    if (countMatches(await this.lines(), match) === 0) {
                        gone = true;
                        break;
                    }
                    await sleep(100);
                }
                const ms = Date.now() - start;
                this.emit({ type: "waitForContent:end", text: `gone: ${label}`, ms, found: gone });
                this.metrics[`waitForGone_${label}_ms`] = ms;
                if (!gone)
                    await this.fail(
                        `timeout_waitForGone_${this.stableIdx}`,
                        `waitForGone ${label} timed out after ${ms}ms`
                    );
                return;
            }

            case "assert": {
                const match = this.matchOf(step);
                const count = countMatches(await this.lines(), match);
                const problem = this.countProblem(count, step, `the screen has ${describeMatch(match)}`);
                if (problem) await this.fail("assert_fail", `assert failed: ${problem}`);
                this.emit({ type: "assert:pass", contains: describeMatch(match) });
                return;
            }

            case "assertNot": {
                const match = this.matchOf(step);
                const found = findAll(await this.lines(), match);
                if (found.length > 0) {
                    const at = found[0]!;
                    await this.fail(
                        "assert_fail",
                        `assertNot failed: the screen has ${describeMatch(match)} (${found.length}x, first at row ${at.row}, col ${at.col})`
                    );
                }
                this.emit({ type: "assert:pass", contains: `not ${describeMatch(match)}` });
                return;
            }

            case "assertStyle": {
                const match = this.matchOf(step);
                const found = findAll(await this.lines(), match);
                const nth = step.occurrence ?? 1;
                const at = found[nth - 1];
                if (!at)
                    await this.fail(
                        "assert_fail",
                        `assertStyle failed: ${describeMatch(match)} is not on the screen (occurrence ${nth})`
                    );
                const hit = at as Location;
                const wanted = {
                    fg: step.fg,
                    bg: step.bg,
                    bold: step.bold,
                    dim: step.dim,
                    italic: step.italic,
                    underline: step.underline,
                    inverse: step.inverse,
                    strikethrough: step.strikethrough,
                };
                for (let c = hit.col; c < hit.col + hit.width; c++) {
                    const style = session.emulator.cellStyle(hit.row - 1, c - 1);
                    const problem = style ? styleMismatch(style, wanted) : "no such cell";
                    if (problem) {
                        await this.fail(
                            "assert_fail",
                            `assertStyle failed for ${describeMatch(match)} at row ${hit.row}, col ${c}: ${problem}`
                        );
                    }
                }
                this.emit({ type: "assert:pass", contains: `style of ${describeMatch(match)}` });
                return;
            }

            case "snapshot": {
                await session.emulator.flush();
                const taken = step.region
                    ? ((): Snapshot => {
                          const plain = regionText(session.emulator.readLines(), step.region);
                          return { raw: "", plain, ansi: plain };
                      })()
                    : await session.takeSnapshot();
                await this.snapshot(step.name, taken);
                this.metrics[`snapshot_${step.name}_ms`] = Date.now() - this.lastSnapshotTime;
                this.lastSnapshotTime = Date.now();
                return;
            }

            case "assertSnapshot": {
                const dir =
                    this.options.goldenDir ??
                    path.join(ROOT, "scripts", "tui-test", "golden", this.options.scenario.name ?? "unnamed");
                const file = path.join(dir, `${step.name}.txt`);
                const current = async (): Promise<string> => regionText(await this.lines(), step.region);

                if (this.options.updateGolden) {
                    fs.mkdirSync(dir, { recursive: true });
                    fs.writeFileSync(file, (await current()) + "\n");
                    this.info("golden", `wrote ${path.relative(ROOT, file)}`);
                    return;
                }
                if (!fs.existsSync(file)) {
                    await this.fail(
                        "golden_missing",
                        `No golden file ${path.relative(ROOT, file)}: run the scenario with --update-golden`
                    );
                }
                const expected = maskText(
                    fs.readFileSync(file, "utf-8").replace(/\r\n/g, "\n").replace(/\n+$/, ""),
                    step.mask
                );
                const start = Date.now();
                let diff = "";
                for (;;) {
                    diff = lineDiff(expected, maskText(await current(), step.mask));
                    if (diff === "" || Date.now() - start >= (step.timeout ?? 0)) break;
                    await sleep(100);
                }
                if (diff !== "") {
                    await this.fail(
                        `golden_diff_${step.name}`,
                        `assertSnapshot "${step.name}" differs from ${path.relative(ROOT, file)} (- golden, + screen):\n${diff}`
                    );
                }
                this.emit({ type: "assert:pass", contains: `snapshot "${step.name}" equals its golden file` });
                return;
            }

            case "screenshot": {
                await session.emulator.flush();
                const imgPath = path.join(os.tmpdir(), "goblin-tui-test", `${step.name}.png`);
                await session.emulator.renderToImage(imgPath);
                this.emit({ type: "screenshot", name: step.name, path: imgPath });
                return;
            }

            case "screenshot-browser": {
                await session.emulator.flush();
                const imgPath = path.join(os.tmpdir(), "goblin-tui-test", `${step.name}.png`);
                await renderToImageBrowser(session.cols, session.rows, session.rawBuffer, imgPath);
                this.emit({ type: "screenshot", name: step.name, path: imgPath });
                return;
            }

            case "screenshot-powershell": {
                await session.emulator.flush();
                const imgPath = path.join(os.tmpdir(), "goblin-tui-test", `${step.name}.png`);
                if (process.platform !== "win32") {
                    // Windows Terminal only exists on Windows: use the built-in emulator instead of crashing the run.
                    console.error(
                        `[tui-test] screenshot-powershell needs Windows: "${step.name}" uses the built-in emulator`
                    );
                    await session.emulator.renderToImage(imgPath);
                } else {
                    await renderToImagePowerShell(
                        session.cols,
                        session.rows,
                        session.emulator.readScreenAnsi(),
                        imgPath
                    );
                }
                this.emit({ type: "screenshot", name: step.name, path: imgPath });
                return;
            }

            case "resize": {
                this.info("resize", `${step.cols}x${step.rows}`);
                this.mark(`resize ${step.cols}x${step.rows}`);
                session.resize(step.cols, step.rows);
                return;
            }

            case "click": {
                const at = await this.point(step);
                const mods = { shift: step.shift, alt: step.alt, ctrl: step.ctrl };
                this.info(
                    "click",
                    `${step.double ? "double " : ""}${step.button ?? "left"} at col ${at.col}, row ${at.row}`
                );
                this.mark(`click ${at.col},${at.row}`);
                for (let i = 0; i < (step.double ? 2 : 1); i++) {
                    session.write(mousePress(at, step.button, mods), `mouse press ${at.col},${at.row}`);
                    await sleep(15);
                    session.write(mouseRelease(at, step.button, mods), `mouse release ${at.col},${at.row}`);
                    await sleep(15);
                }
                return;
            }

            case "hover": {
                const at = await this.point(step);
                this.info("hover", `col ${at.col}, row ${at.row}`);
                this.mark(`hover ${at.col},${at.row}`);
                session.write(mouseMove(at, step), `mouse move ${at.col},${at.row}`);
                return;
            }

            case "drag": {
                const from = await this.point(step.from);
                const to = await this.point(step.to);
                this.info("drag", `from col ${from.col}, row ${from.row} to col ${to.col}, row ${to.row}`);
                this.mark(`drag ${from.col},${from.row}→${to.col},${to.row}`);
                const events = mouseDrag(from, to, step.button, step, step.steps);
                if (step.hold) events.pop();
                for (const event of events) {
                    session.write(event, "mouse drag");
                    await sleep(15);
                }
                return;
            }

            case "wheel": {
                const at = await this.point(step);
                const count = step.count ?? 1;
                this.info("wheel", `${step.direction} x${count} at col ${at.col}, row ${at.row}`);
                this.mark(`wheel ${step.direction}`);
                for (let i = 0; i < count; i++) {
                    session.write(mouseWheel(at, step.direction, step), `mouse wheel ${step.direction}`);
                    await sleep(20);
                }
                return;
            }

            case "pressUntil": {
                const match = this.matchOf(step);
                const max = step.max ?? 30;
                const delay = step.delayMs ?? 150;
                let pressed = 0;
                while (countMatches(await this.lines(), match) === 0) {
                    if (pressed >= max) {
                        await this.fail(
                            "assert_fail",
                            `pressUntil failed: ${describeMatch(match)} did not show up after ${max} x ${step.key}`
                        );
                    }
                    this.emit({ type: "key", key: step.key });
                    this.mark(step.key);
                    session.write(resolveKey(step.key), step.key);
                    pressed++;
                    await sleep(delay);
                }
                this.info("pressUntil", `${describeMatch(match)} after ${pressed} x ${step.key}`);
                return;
            }

            case "assertFile": {
                const file = session.resolveDataPath(step.path);
                const wantExists = step.exists ?? true;
                await this.until(
                    () => {
                        const exists = fs.existsSync(file);
                        if (exists !== wantExists) return exists ? "exists, but should not" : "does not exist";
                        if (!exists) return "";
                        if (step.contains === undefined && step.matches === undefined) return "";
                        const text = fs.readFileSync(file, "utf-8");
                        if (step.contains !== undefined && !text.includes(step.contains))
                            return `does not contain ${JSON.stringify(step.contains)}`;
                        if (step.matches !== undefined && !new RegExp(step.matches).test(text))
                            return `does not match /${step.matches}/`;
                        return "";
                    },
                    step.timeout ?? STATE_WAIT_MS,
                    `assertFile ${step.path}`
                );
                this.emit({ type: "assert:pass", contains: `file ${step.path}` });
                return;
            }

            case "assertJson": {
                const file = session.resolveDataPath(step.file);
                const jsonPath = step.path;
                const timeout = step.timeout;
                const expected: JsonExpectation = {};
                for (const key of [
                    "exists",
                    "equals",
                    "contains",
                    "matches",
                    "gt",
                    "gte",
                    "lt",
                    "lte",
                    "length",
                ] as const) {
                    if (key in step) Object.assign(expected, { [key]: step[key] });
                }
                await this.until(
                    () => {
                        let root: unknown;
                        try {
                            root = JSON.parse(stripBom(fs.readFileSync(file, "utf-8")));
                        } catch (error) {
                            return `cannot read ${step.file}: ${error instanceof Error ? error.message : String(error)}`;
                        }
                        const value = jsonPath ? getPath(root, jsonPath) : root;
                        const problem = checkJsonValue(value, expected);
                        return problem ? `${jsonPath ?? "(root)"} ${problem}` : "";
                    },
                    timeout ?? STATE_WAIT_MS,
                    `assertJson ${step.file}`
                );
                this.emit({ type: "assert:pass", contains: `${step.file} ${step.path ?? ""}`.trim() });
                return;
            }

            case "assertLog": {
                const regex = step.matches !== undefined ? new RegExp(step.matches) : undefined;
                const what =
                    `log lines ${[step.level, step.contains && JSON.stringify(step.contains), step.matches && `/${step.matches}/`].filter(Boolean).join(" ")}`.trim();
                await this.until(
                    () => {
                        const found = session
                            .readLog()
                            .filter(
                                (e) =>
                                    (step.level === undefined || e.level.toLowerCase() === step.level) &&
                                    (step.contains === undefined || e.message.includes(step.contains)) &&
                                    (regex === undefined || regex.test(e.message))
                            );
                        return this.countProblem(found.length, step, what);
                    },
                    step.timeout ?? STATE_WAIT_MS,
                    "assertLog"
                );
                this.emit({ type: "assert:pass", contains: what });
                return;
            }

            case "assertNoErrors": {
                const minLevel = levelRank(step.level ?? "error");
                const ignore = (step.ignore ?? []).map((p) => new RegExp(p));
                const bad = session
                    .readLog()
                    .filter((e) => levelRank(e.level) >= minLevel && !ignore.some((r) => r.test(e.message)));
                if (bad.length > 0) {
                    await this.fail(
                        "assert_fail",
                        `assertNoErrors failed: ${bad.length} ${step.level ?? "error"} line(s) in the log:\n` +
                            bad
                                .slice(0, 5)
                                .map((e) => `  ${e.level} ${e.message.slice(0, 200)}`)
                                .join("\n")
                    );
                }
                this.emit({ type: "assert:pass", contains: `no ${step.level ?? "error"} in the log` });
                return;
            }

            case "assertRequest": {
                if (!session.hasNetwork) throw new Error("assertRequest needs a `network` section in the scenario");
                const regex = step.matches !== undefined ? new RegExp(step.matches) : undefined;
                const what =
                    `requests ${[step.method, step.url && JSON.stringify(step.url), step.matches && `/${step.matches}/`].filter(Boolean).join(" ")}`.trim();
                await this.until(
                    () => {
                        const found = session
                            .readRequests()
                            .filter(
                                (r) =>
                                    (step.method === undefined || r.method === step.method.toUpperCase()) &&
                                    (step.url === undefined || r.url.includes(step.url)) &&
                                    (regex === undefined || regex.test(r.url))
                            );
                        return this.countProblem(found.length, step, what);
                    },
                    step.timeout ?? STATE_WAIT_MS,
                    "assertRequest"
                );
                this.emit({ type: "assert:pass", contains: what });
                return;
            }

            case "setClipboard": {
                fs.writeFileSync(session.clipboardFile, step.text);
                this.info("setClipboard", JSON.stringify(step.text));
                return;
            }

            case "assertClipboard": {
                const regex = step.matches !== undefined ? new RegExp(step.matches) : undefined;
                await this.until(
                    () => {
                        const text = fs.existsSync(session.clipboardFile)
                            ? fs.readFileSync(session.clipboardFile, "utf-8")
                            : "";
                        const shown = JSON.stringify(text.length > 200 ? `${text.slice(0, 200)}…` : text);
                        if (step.empty !== undefined && (text === "") !== step.empty)
                            return step.empty ? `holds ${shown}, wanted nothing` : "is empty";
                        if (step.equals !== undefined && text !== step.equals)
                            return `holds ${shown}, wanted ${JSON.stringify(step.equals)}`;
                        if (step.contains !== undefined && !text.includes(step.contains))
                            return `holds ${shown}, which does not contain ${JSON.stringify(step.contains)}`;
                        if (regex !== undefined && !regex.test(text))
                            return `holds ${shown}, which does not match /${step.matches}/`;
                        return "";
                    },
                    step.timeout ?? STATE_WAIT_MS,
                    "assertClipboard: the clipboard"
                );
                this.emit({ type: "assert:pass", contains: "clipboard" });
                return;
            }

            case "network": {
                const current = step.append ? session.currentNetwork() : {};
                session.setNetwork({
                    mode: step.mode ?? current.mode,
                    rules: [...(current.rules ?? []), ...(step.rules ?? [])],
                });
                this.info(
                    "network",
                    `${step.rules?.length ?? 0} rule(s)${step.append ? " added" : ""}, mode ${step.mode ?? current.mode ?? "offline"}`
                );
                return;
            }

            case "exit": {
                if (step.key) {
                    this.emit({ type: "key", key: step.key });
                    this.mark(step.key);
                    session.write(resolveKey(step.key), step.key);
                }
                const exited = await session.waitForExit(step.timeout ?? 10000);
                if (!exited)
                    await this.fail("exit_timeout", `exit: the app was still running after ${step.timeout ?? 10000}ms`);
                if (step.code !== undefined && session.appExitCode !== step.code) {
                    await this.fail(
                        "exit_code",
                        `exit: the app exited with code ${session.appExitCode}, wanted ${step.code}`
                    );
                }
                this.info("exit", `code ${session.appExitCode}`);
                return;
            }

            case "mark":
                this.mark(step.label);
                return;

            case "startLoad":
            case "stopLoad": {
                if (!session.loadControl) throw new Error(`${step.type} needs profiling (run with --profile)`);
                this.mark(step.type === "startLoad" ? "load start" : "load stop");
                fs.mkdirSync(path.dirname(session.loadControl), { recursive: true });
                fs.writeFileSync(
                    session.loadControl,
                    JSON.stringify(
                        step.type === "startLoad"
                            ? { action: "start", ...this.options.scenario.load }
                            : { action: "stop" }
                    )
                );
                return;
            }

            default: {
                const unknown: { type?: unknown } = step;
                throw new Error(`Unknown step type "${String(unknown.type)}"`);
            }
        }
    }
}
