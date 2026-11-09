import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// `installSource` reads install.json from GOBLIN_DATA_DIR, resolved when #constants loads.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-updater-test-"));
process.env.GOBLIN_DATA_DIR = dataDir;
const { isNewer, checkForUpdate } = await import("#updater/updateChecker");
const { getInstaller, getUpdateArgv, getUpdateCommand } = await import("#updater/installSource");
const { APP_VERSION } = await import("#constants");

afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));

describe("isNewer", () => {
    test.each([
        ["0.1.15", "0.1.16", true],
        ["0.1.15", "0.2.0", true],
        ["0.1.15", "1.0.0", true],
        ["0.1.15", "0.1.15", false],
        ["0.1.15", "0.1.14", false],
        ["0.2.0", "0.1.99", false],
        ["1.0.0", "0.9.9", false],
    ])("%s → %s is %s", (local, remote, expected) => {
        expect(isNewer(local, remote)).toBe(expected);
    });

    test("compares numbers, not strings (1.10.0 is newer than 1.9.0)", () => {
        expect(isNewer("1.9.0", "1.10.0")).toBe(true);
        expect(isNewer("1.10.0", "1.9.0")).toBe(false);
    });

    test("accepts a leading v on either side (GitHub tags are v-prefixed)", () => {
        expect(isNewer("0.1.15", "v0.2.0")).toBe(true);
        expect(isNewer("v0.2.0", "0.2.0")).toBe(false);
    });

    test("a missing minor/patch counts as 0", () => {
        expect(isNewer("1", "1.0.1")).toBe(true);
        expect(isNewer("1.2", "1.2.0")).toBe(false);
    });

    test("a tag that is not a version never offers an update", () => {
        expect(isNewer("0.1.15", "nightly")).toBe(false);
        expect(isNewer("0.1.15", "")).toBe(false);
    });
});

describe("checkForUpdate", () => {
    afterEach(() => vi.unstubAllGlobals());

    const answer = (body: unknown, ok = true) =>
        vi.fn().mockResolvedValue({ ok, json: async () => body } as unknown as Response);

    test("reports a newer release with its version (without the v) and URL", async () => {
        vi.stubGlobal("fetch", answer({ tag_name: "v999.0.0", html_url: "https://example.test/r" }));
        await expect(checkForUpdate()).resolves.toEqual({
            hasUpdate: true,
            latestVersion: "999.0.0",
            releaseUrl: "https://example.test/r",
        });
    });

    test("reports hasUpdate false when the running version is the latest", async () => {
        vi.stubGlobal("fetch", answer({ tag_name: `v${APP_VERSION}`, html_url: "https://example.test/r" }));
        const info = await checkForUpdate();
        expect(info?.hasUpdate).toBe(false);
        expect(info?.latestVersion).toBe(APP_VERSION);
    });

    test("an HTTP error is not an update check result", async () => {
        vi.stubGlobal("fetch", answer({}, false));
        await expect(checkForUpdate()).resolves.toBeNull();
    });

    test("a network failure or a timeout is swallowed", async () => {
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
        await expect(checkForUpdate()).resolves.toBeNull();
    });

    test("an answer that is not the expected JSON is swallowed", async () => {
        vi.stubGlobal("fetch", answer(null));
        await expect(checkForUpdate()).resolves.toBeNull();
    });

    test("sends a User-Agent (GitHub rejects requests without one)", async () => {
        const fetchMock = answer({ tag_name: "v1.0.0", html_url: "u" });
        vi.stubGlobal("fetch", fetchMock);
        await checkForUpdate();
        const init = fetchMock.mock.calls[0][1] as RequestInit;
        expect((init.headers as Record<string, string>)["User-Agent"]).toBeTruthy();
    });
});

describe("getInstaller", () => {
    const installJson = path.join(dataDir, "install.json");
    const originalArgv1 = process.argv[1];

    beforeEach(() => {
        process.argv[1] = "/somewhere/else/cli.js"; // nothing that names a package manager
        fs.rmSync(installJson, { force: true });
    });
    afterEach(() => {
        process.argv[1] = originalArgv1;
        fs.rmSync(installJson, { force: true });
    });

    test.each([
        ["C:\\Users\\me\\AppData\\Local\\Yarn\\Data\\global\\node_modules\\goblin-malin\\dist\\cli.js", "yarn"],
        ["/home/me/.config/yarn/global/node_modules/goblin-malin/dist/cli.js", "yarn"],
        ["/home/me/.local/share/pnpm/global/5/.pnpm/goblin-malin/dist/cli.js", "pnpm"],
        ["C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\goblin-malin\\dist\\cli.js", "npm"],
    ])("detects the installer from the running script path (%s)", (scriptPath, installer) => {
        process.argv[1] = scriptPath;
        expect(getInstaller()).toBe(installer);
    });

    test("the running script path beats install.json (both managers may have the package)", () => {
        fs.writeFileSync(installJson, JSON.stringify({ installer: "yarn" }));
        process.argv[1] = "/usr/lib/npm/node_modules/goblin-malin/dist/cli.js";
        expect(getInstaller()).toBe("npm");
    });

    test("falls back to install.json when the path says nothing", () => {
        fs.writeFileSync(installJson, JSON.stringify({ installer: "pnpm" }));
        expect(getInstaller()).toBe("pnpm");
    });

    test("an unknown installer in install.json is reported as unknown", () => {
        fs.writeFileSync(installJson, JSON.stringify({ installer: "bun" }));
        expect(getInstaller()).toBe("unknown");
    });

    test("no install.json, or one that is not JSON, means npm", () => {
        expect(getInstaller()).toBe("npm");
        fs.writeFileSync(installJson, "{ not json");
        expect(getInstaller()).toBe("npm");
    });
});

describe("getUpdateArgv / getUpdateCommand", () => {
    const installJson = path.join(dataDir, "install.json");
    const originalArgv1 = process.argv[1];
    beforeEach(() => {
        process.argv[1] = "/somewhere/else/cli.js";
    });
    afterEach(() => {
        process.argv[1] = originalArgv1;
        fs.rmSync(installJson, { force: true });
    });

    test.each([
        ["yarn", { bin: "yarn", args: ["global", "add", "goblin-malin@1.2.3"] }],
        ["pnpm", { bin: "pnpm", args: ["add", "-g", "goblin-malin@1.2.3"] }],
        ["npm", { bin: "npm", args: ["install", "-g", "goblin-malin@1.2.3"] }],
        ["unknown", { bin: "npm", args: ["install", "-g", "goblin-malin@1.2.3"] }],
    ])("the %s command", (installer, expected) => {
        fs.writeFileSync(installJson, JSON.stringify({ installer }));
        expect(getUpdateArgv("1.2.3")).toEqual(expected);
    });

    test("without a version it installs the package unversioned (= latest)", () => {
        expect(getUpdateArgv().args).toContain("goblin-malin");
    });

    test("the display command is the argv joined", () => {
        expect(getUpdateCommand("1.2.3")).toBe("npm install -g goblin-malin@1.2.3");
    });
});
