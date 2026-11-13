import { describe, expect, test } from "vitest";
import { runScenario } from "../../scripts/tui-test/runner.ts";

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
                // Longer than the debounce (80 ms): each key is isolated. The first one only puts the cursor on the
                // list (it also mounts the hints of the focused list: a few frames of its own).
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

        const keys = result.profile!.interactions.filter((it) => it.index >= 1 && it.label !== "end");
        expect(keys).toHaveLength(3);
        for (const it of keys) {
            expect(it.bytes, `${it.label}: ${it.bytes} bytes`).toBeGreaterThan(10_000);
            expect(it.bytes, `${it.label}: ${it.bytes} bytes`).toBeLessThan(30_000);
        }
    });
});
