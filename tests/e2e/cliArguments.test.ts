import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterAll, describe, expect, test } from "vitest";

// Started from a pipe, a service or a script, the app used to show a React "Too many re-renders" error and never exit;
// `--version` and `--help` opened the whole interface.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-cli-test-"));
afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const run = (...args: string[]) =>
    spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], {
        cwd: path.resolve(__dirname, "../.."),
        env: { ...process.env, GOBLIN_DATA_DIR: dataDir },
        input: "",
        encoding: "utf8",
        timeout: 60_000,
    });

describe("the command line", () => {
    test("--version prints the version and exits", () => {
        const r = run("--version");
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    });

    test("--help prints the usage and exits", () => {
        const r = run("--help");
        expect(r.status).toBe(0);
        expect(r.stdout).toMatch(/Usage: goblin-malin/);
    });

    test("without a terminal it says so and exits with an error, instead of hanging", () => {
        const r = run();
        expect(r.signal).toBeNull();
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/interactive terminal/);
        // Nothing was started: no lock, no session file.
        expect(fs.readdirSync(dataDir)).toEqual([]);
    });
});
