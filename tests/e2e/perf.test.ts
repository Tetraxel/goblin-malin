import { describe, expect, test } from "vitest";
import { runScenario } from "../../scripts/tui-test/runner.ts";
import type { Scenario } from "../../scripts/tui-test/types.ts";

// Component render-profiling regression guard. Unlike the screenshot smoke test,
// this asserts on machine-independent render signals: it fails only on
// `error`-severity anomalies (today: per-interaction commit cascades), which
// indicate effect loops / runaway setState rather than raw timing. ms-based
// budgets surface as `warn` and are reported but do not fail CI.
//
// No `name` is set, so this runs purely against global thresholds (no baseline
// file is read or written).
describe("render profile", () => {
    test("navigation flow has no error-severity render anomalies", async () => {
        const result = await runScenario({
            dataDir: "scripts/tui-test/fixtures/empty",
            profile: { enabled: true },
            steps: [
                { type: "stable", timeout: 10000 },
                { type: "waitForContent", text: "No task to run", timeout: 5000 },
                { type: "key", key: "ArrowRight" },
                { type: "stable" },
                { type: "key", key: "ArrowRight" },
                { type: "stable" },
                { type: "key", key: "Enter" },
                { type: "stable" },
                { type: "key", key: "Escape" },
                { type: "stable" },
            ],
        });

        const profile = result.profile;
        expect(profile).toBeDefined();
        expect(profile!.totals.commits).toBeGreaterThan(0);
        expect(profile!.components.length).toBeGreaterThan(0);

        const errors = profile!.anomalies.filter((a) => a.severity === "error");
        expect(errors, errors.map((e) => e.message).join("; ")).toHaveLength(0);
    });

    // AUDIT-performance-2.md, PERF2-02: the lower panel used to follow the cursor through a trailing 80 ms debounce,
    // so every isolated key painted two full-screen frames, the second one late. Bytes per key do not depend on
    // the machine, unlike milliseconds, so they can gate CI: with a full redraw (the default on Linux and macOS) a
    // frame of this 128x50 screen is ~20 KB, so one frame per key is ~20 KB and two are ~41 KB.
    // Windows is the strict case: there Ink repaints a full-screen frame after every commit, even an unchanged one,
    // so an empty commit (a `setState` that React re-renders for and then bails out of) costs a frame too.
    test("an isolated key paints one frame, not two", async () => {
        const result = await runScenario({
            terminal: { cols: 128, rows: 50 },
            dataDir: "scripts/tui-test/fixtures/50-tasks-with-metadata",
            // No spinner ticks: they would add frames of their own.
            settings: { general: { animationsEnabled: false, reduceTerminalOutput: false } },
            profile: { enabled: true },
            steps: [
                { type: "stable", timeout: 20000, quiescenceMs: 1000 },
                { type: "waitForContent", text: "Hooked", timeout: 10000 },
                { type: "wait", ms: 1500 },
                // Longer than the debounce (80 ms): each key is isolated. The first two keys are set-up, not measured:
                // the first only puts the cursor on the list (it also mounts the hints of the focused list), the
                // second selects a task, whose contextual actions register new shortcuts while rendering (the hint
                // bar then needs a second commit; moving between tasks with the same actions does not).
                { type: "key", key: "ArrowDown" },
                { type: "wait", ms: 1000 },
                { type: "key", key: "ArrowDown" },
                { type: "wait", ms: 1000 },
                { type: "key", key: "ArrowDown" },
                { type: "wait", ms: 600 },
                { type: "key", key: "ArrowDown" },
                { type: "wait", ms: 600 },
                { type: "key", key: "ArrowUp" },
                { type: "wait", ms: 600 },
                // What follows (shutdown) must not be counted as part of the last key.
                { type: "mark", label: "end" },
            ],
        });

        const keys = result.profile!.interactions.filter((it) => it.index >= 2 && it.label !== "end");
        expect(keys).toHaveLength(3);
        for (const it of keys) {
            expect(it.bytes, `${it.label}: ${it.bytes} bytes`).toBeGreaterThan(10_000);
            expect(it.bytes, `${it.label}: ${it.bytes} bytes`).toBeLessThan(30_000);
        }
    });

    // AUDIT-performance-2.md, PERF2-03: "Reduce terminal output" (Ink's incremental rendering) is on by default on
    // Windows, on top of the patched Output with its cross-frame row cache. Both keep state from frame to frame, so
    // the screens they leave behind must be the same as with a full redraw after every kind of change: cursor moves,
    // focus changes, a view switch, a modal opening (more lines) and closing (fewer lines).
    test("incremental rendering leaves the same screen as a full redraw", async () => {
        const steps = [
            { type: "stable", timeout: 20000, quiescenceMs: 1000 },
            { type: "waitForContent", text: "Hooked", timeout: 10000 },
            { type: "wait", ms: 1000 },
            // Focus starts on the toolbar: → then Enter opens the Sessions modal, Escape closes it.
            { type: "key", key: "ArrowRight" },
            { type: "key", key: "Enter" },
            { type: "wait", ms: 700 },
            { type: "snapshot", name: "modal-open" },
            { type: "key", key: "Escape" },
            { type: "wait", ms: 700 },
            { type: "snapshot", name: "modal-closed" },
            ...["ArrowDown", "ArrowDown", "Tab", "ArrowDown", "Tab", "2", "ArrowDown", "1", "Ctrl+A", "Escape"].flatMap(
                (key, i) => [
                    { type: "key", key },
                    { type: "wait", ms: 500 },
                    { type: "snapshot", name: `step-${i}-${key}` },
                ]
            ),
        ] as Scenario["steps"];
        const run = (reduceTerminalOutput: boolean) =>
            runScenario({
                terminal: { cols: 128, rows: 50 },
                dataDir: "scripts/tui-test/fixtures/50-tasks-with-metadata",
                settings: { general: { animationsEnabled: false, showWelcomeTutorial: false, reduceTerminalOutput } },
                steps,
            });
        // Ids and times differ from one run to the next; they are not what is compared.
        const normalize = (text: string) => text.replace(/[0-9a-f]{6,}|\d+:\d+|\d+\s*(?:ms|s|m|h)\b/gi, "#");
        const full = await run(false);
        const incremental = await run(true);
        const names = Object.keys(full.snapshots).filter(
            (name) => name.startsWith("step-") || name.startsWith("modal-")
        );
        expect(names.length).toBeGreaterThan(10);
        // The modal really changed the screen (otherwise the shrink case is not exercised).
        expect(full.snapshots["modal-open"]!.plain).not.toEqual(full.snapshots["modal-closed"]!.plain);
        for (const name of names) {
            expect(normalize(incremental.snapshots[name]!.plain), name).toEqual(normalize(full.snapshots[name]!.plain));
        }
    });
});
