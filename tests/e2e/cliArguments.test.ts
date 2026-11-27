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

    test("ext works without a terminal and never opens the interface", () => {
        // A data folder of its own: the one above must stay empty for the next test.
        const extDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-cli-ext-test-"));
        try {
            const env = { ...process.env, GOBLIN_DATA_DIR: extDataDir };
            const ext = (...args: string[]) =>
                spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", "ext", ...args], {
                    cwd: path.resolve(__dirname, "../.."),
                    env,
                    input: "",
                    encoding: "utf8",
                    timeout: 60_000,
                });
            const r = ext("list");
            expect(r.status).toBe(0);
            expect(r.stdout).toMatch(/No extension in/);
            expect(ext("nope").status).toBe(2);
            expect(fs.existsSync(path.join(extDataDir, "goblin-malin.lock"))).toBe(false);
        } finally {
            fs.rmSync(extDataDir, { recursive: true, force: true });
        }
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
