import { afterAll, beforeAll, describe, expect, test } from "vitest";
import * as fs from "fs";
import * as http from "http";
import * as os from "os";
import * as path from "path";
import type { AddressInfo } from "net";

// Audit v0.2.3, "Exit, update, CLI", "Claude and the agent" and "Other": UPD-02, CLAUDE-03, AGENT-01, HTTP-01, COOKIE-01, MPV-01.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-exit-other-test-"));
process.env.GOBLIN_DATA_DIR = dataDir;
afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));

describe("UPD-02: which version is newer", () => {
    let isNewer: typeof import("#updater/updateChecker").isNewer;
    beforeAll(async () => {
        isNewer = (await import("#updater/updateChecker")).isNewer;
    });

    test("a pre-release is not NaN: it is older than its release and newer than the one before", () => {
        expect(isNewer("0.2.4-beta.1", "0.2.4")).toBe(true);
        expect(isNewer("0.2.4", "0.2.4-beta.1")).toBe(false);
        expect(isNewer("0.2.3", "0.2.4-beta.1")).toBe(true);
        expect(isNewer("0.2.4-beta.1", "0.2.4-beta.2")).toBe(true);
        expect(isNewer("0.2.4-beta.2", "0.2.4-beta.10")).toBe(true);
        expect(isNewer("0.2.4-beta.2", "0.2.4-beta.2")).toBe(false);
        expect(isNewer("0.2.4-alpha", "0.2.4-beta")).toBe(true);
        expect(isNewer("0.2.4+build.1", "0.2.4")).toBe(false);
    });

    test("a tag that is not a version still never offers an update", () => {
        expect(isNewer("0.2.3", "nightly")).toBe(false);
        expect(isNewer("0.2.3", "")).toBe(false);
        expect(isNewer("0.2.3", "1.2.3.4")).toBe(false);
    });
});

describe("UPD-02: which package manager owns the install", () => {
    let detect: typeof import("#updater/installSource").detectInstallerFromPath;
    beforeAll(async () => {
        detect = (await import("#updater/installSource")).detectInstallerFromPath;
    });

    test("only the folders where each one keeps its global packages count", () => {
        expect(
            detect("C:\\Users\\a\\AppData\\Local\\Yarn\\Data\\global\\node_modules\\goblin-malin\\dist\\cli.js")
        ).toBe("yarn");
        expect(detect("/home/a/.config/yarn/global/node_modules/goblin-malin/dist/cli.js")).toBe("yarn");
        expect(detect("/home/a/.local/share/pnpm/global/5/node_modules/goblin-malin/dist/cli.js")).toBe("pnpm");
        expect(detect("C:\\Users\\a\\AppData\\Roaming\\npm\\node_modules\\goblin-malin\\dist\\cli.js")).toBe("npm");
        expect(detect("/usr/local/lib/node_modules/goblin-malin/dist/cli.js")).toBe("npm");
    });

    test("a user or a folder that is merely called yarn, npm or pnpm picks nothing", () => {
        expect(detect("/home/yarn/projects/goblin-malin/dist/cli.js")).toBeNull();
        expect(detect("/home/npm/goblin-malin/dist/cli.js")).toBeNull();
        expect(detect("C:\\Users\\pnpm\\goblin-malin\\dist\\cli.js")).toBeNull();
        expect(detect("")).toBeNull();
    });
});

describe("UPD-02: lines out of chunks", () => {
    test("a line cut in two chunks, a split multi-byte character, CRLF and blank lines", async () => {
        const { createLineSplitter } = await import("#utils/lineSplitter");
        const lines: string[] = [];
        const splitter = createLineSplitter((line) => lines.push(line));
        const euro = Buffer.from("coût: 5€\r\n");
        // Cut inside the three bytes of "€".
        splitter.write(Buffer.from("first li"));
        splitter.write(Buffer.from("ne\r\n\r\n"));
        splitter.write(euro.subarray(0, euro.length - 4));
        splitter.write(euro.subarray(euro.length - 4));
        splitter.write(Buffer.from("last without end"));
        splitter.end();
        expect(lines).toEqual(["first line", "coût: 5€", "last without end"]);
    });
});

describe("CLAUDE-03: credentials stay out of the environment programs inherit", () => {
    test("adopting moves a key out of process.env and reading still finds it", async () => {
        const { appSecrets } = await import("#base/appSecrets");
        process.env.TEST_SECRET_KEY = "hunter2";
        process.env.TEST_OTHER_KEY = "keep";
        appSecrets.adopt(["TEST_SECRET_KEY"]);
        expect(process.env.TEST_SECRET_KEY).toBeUndefined();
        expect(appSecrets.get("TEST_SECRET_KEY")).toBe("hunter2");
        // A key nobody declared is left for the programs that expect it (a proxy, a Claude API key).
        expect(process.env.TEST_OTHER_KEY).toBe("keep");
        expect(appSecrets.get("TEST_OTHER_KEY")).toBe("keep");
        appSecrets.delete("TEST_SECRET_KEY");
        expect(appSecrets.get("TEST_SECRET_KEY")).toBeUndefined();
        delete process.env.TEST_OTHER_KEY;
    });

    test("a value typed in a wizard is kept for the app only", async () => {
        const { appSecrets } = await import("#base/appSecrets");
        appSecrets.set("TEST_WIZARD_PASSWORD", "s3cret");
        expect(process.env.TEST_WIZARD_PASSWORD).toBeUndefined();
        expect(appSecrets.get("TEST_WIZARD_PASSWORD")).toBe("s3cret");
        expect(appSecrets.asEnv().TEST_WIZARD_PASSWORD).toBe("s3cret");
        appSecrets.delete("TEST_WIZARD_PASSWORD");
    });

    test("a credential set in the user's own environment is still read", async () => {
        const { appSecrets } = await import("#base/appSecrets");
        process.env.TEST_REAL_ENV_KEY = "from-shell";
        expect(appSecrets.get("TEST_REAL_ENV_KEY")).toBe("from-shell");
        delete process.env.TEST_REAL_ENV_KEY;
    });
});

describe("HTTP-01: a download has a size and a time limit", () => {
    let server: http.Server;
    let base: string;
    beforeAll(async () => {
        server = http.createServer((req, res) => {
            if (req.url === "/big-announced") {
                res.writeHead(200, { "Content-Length": String(50 * 1024 * 1024) });
                res.end();
            } else if (req.url === "/endless") {
                res.writeHead(200);
                const timer = setInterval(() => res.write("x".repeat(1024)), 5);
                res.on("close", () => clearInterval(timer));
            } else if (req.url === "/multibyte") {
                // 4000 euro signs: 4000 characters but 12000 bytes, the first one sent in two pieces.
                const body = Buffer.from("€".repeat(4000));
                res.writeHead(200);
                res.write(body.subarray(0, 2));
                setTimeout(() => res.end(body.subarray(2)), 20);
            } else if (req.url === "/trickle") {
                res.writeHead(200);
                const timer = setInterval(() => res.write("."), 20);
                res.on("close", () => clearInterval(timer));
            } else {
                res.writeHead(200);
                res.end("hello");
            }
        });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(() => {
        server.closeAllConnections();
        server.close();
    });

    test("an ordinary answer is read", async () => {
        const { httpsGetText } = await import("#utils/http");
        await expect(httpsGetText(`${base}/ok`)).resolves.toBe("hello");
    });

    test("a body announced bigger than the limit is refused at once", async () => {
        const { httpsGetText } = await import("#utils/http");
        await expect(httpsGetText(`${base}/big-announced`, { maxBytes: 1024 })).rejects.toThrow(/more than the 1024/);
    });

    test("a body that grows past the limit is cut", async () => {
        const { httpsGetText } = await import("#utils/http");
        await expect(httpsGetText(`${base}/endless`, { maxBytes: 4096 })).rejects.toThrow();
    });

    test("the limit counts bytes, not characters, and a character cut between chunks stays whole", async () => {
        const { httpsGetText } = await import("#utils/http");
        // 4000 characters fit a 5000 limit counted in characters, but not counted in bytes (12000).
        await expect(httpsGetText(`${base}/multibyte`, { maxBytes: 5000 })).rejects.toThrow();
        await expect(httpsGetText(`${base}/multibyte`, { maxBytes: 20_000 })).resolves.toBe("€".repeat(4000));
    });

    test("a trickle that never goes idle still ends at the total time limit", async () => {
        const { httpsGetText } = await import("#utils/http");
        await expect(httpsGetText(`${base}/trickle`, { totalTimeoutMs: 150 })).rejects.toThrow();
    });
});

describe("COOKIE-01: cookie copies a killed run left behind", () => {
    test("old ones of this app are removed, recent ones and other folders are not", async () => {
        const { sweepStaleCookieCopies } =
            await import("#flows/musicDownloadFlow/services/download-providers/ytdlp/cookiesCopy");
        const stale = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-cookies-"));
        const recent = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-cookies-"));
        const other = fs.mkdtempSync(path.join(os.tmpdir(), "someone-elses-"));
        try {
            // "Now" is two hours later for `stale`: only its age is judged, never the clock.
            const old = new Date(Date.now() - 2 * 60 * 60_000);
            fs.utimesSync(stale, old, old);
            fs.utimesSync(other, old, old);

            const removed = await sweepStaleCookieCopies();

            expect(removed).toBeGreaterThanOrEqual(1);
            expect(fs.existsSync(stale)).toBe(false);
            expect(fs.existsSync(recent)).toBe(true);
            expect(fs.existsSync(other)).toBe(true);
        } finally {
            for (const dir of [stale, recent, other]) fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe("DL-05: the whole tree is taken down", () => {
    test("without a pid, or off Windows, a plain kill is what happens, at once", async () => {
        const { killProcessTree } = await import("#utils/killProcessTree");
        let kills = 0;
        killProcessTree({ pid: undefined, kill: () => (kills++, true) });
        expect(kills).toBe(1);
    });

    test.runIf(process.platform === "win32")(
        "on Windows taskkill goes first: the plain kill is not sent before it, only as a fallback",
        async () => {
            const { killProcessTree } = await import("#utils/killProcessTree");
            let kills = 0;
            // No such process: taskkill fails, which is when the fallback is wanted.
            killProcessTree({ pid: 2_000_000_000, kill: () => (kills++, true) });
            expect(kills).toBe(0);
            await new Promise<void>((resolve) => {
                const timer = setInterval(() => {
                    if (kills > 0) {
                        clearInterval(timer);
                        resolve();
                    }
                }, 25);
            });
            expect(kills).toBe(1);
        }
    );
});

describe("MPV-01: the control socket is private", () => {
    test("on Linux and macOS it sits in a folder of the app's own, on Windows the pipe name is random", async () => {
        const { createIpcEndpoint } = await import("#utils/ipcEndpoint");
        const a = await createIpcEndpoint("mpv-ipc-1");
        const b = await createIpcEndpoint("mpv-ipc-1");
        if (process.platform === "win32") {
            expect(a.path).toMatch(/^\\\\\.\\pipe\\mpv-ipc-1-[0-9a-f]{12}$/);
            expect(a.arg).not.toContain("\\");
            expect(a.arg).not.toBe(b.arg);
        } else {
            expect(a.path.startsWith(path.join(dataDir, "run"))).toBe(true);
            expect(fs.statSync(path.dirname(a.path)).mode & 0o077).toBe(0);
        }
    });
});

describe("AGENT-01: writes to one track go one at a time", () => {
    test("two parallel writes on the same track: the second is refused as out of date, not run beside the first", async () => {
        const { installWorld, makeTrack } = await import("./helpers/agentWorld");
        const { agentWrite } = await import("#flows/musicDownloadFlow/agent/taskAccess");
        const { AgentTurn } = await import("#base/agent/agentTurn");

        const task = makeTrack("t1", "Song");
        installWorld([task]);
        const ctx = { turn: new AgentTurn() } as never;
        const revision = task.getRevision();
        const order: string[] = [];
        const write = (name: string) =>
            agentWrite({
                ctx,
                tool: "test",
                task,
                revision,
                label: name,
                change: async () => {
                    order.push(`${name} start`);
                    await new Promise((resolve) => setTimeout(resolve, 20));
                    task.setMetadataOverride({ trackName: name }, { actor: "agent" });
                    order.push(`${name} end`);
                    return { result: { name } };
                },
            });

        const results = await Promise.allSettled([write("first"), write("second")]);

        expect(results[0].status).toBe("fulfilled");
        expect(results[1].status).toBe("rejected");
        // The second never started its change while the first was running.
        expect(order).toEqual(["first start", "first end"]);
    });

    test("a write started later by something a change set going is a write like any other", async () => {
        const { installWorld, makeTrack } = await import("./helpers/agentWorld");
        const { agentWrite } = await import("#flows/musicDownloadFlow/agent/taskAccess");
        const { AgentTurn } = await import("#base/agent/agentTurn");

        const task = makeTrack("t2", "Song");
        installWorld([task]);
        const ctx = { turn: new AgentTurn() } as never;
        let later: Promise<unknown> | undefined;
        await agentWrite({
            ctx,
            tool: "test",
            task,
            revision: task.getRevision(),
            label: "outer",
            change: () => {
                // A timer created inside the change: it runs after the change is over, with nothing to wait for.
                later = new Promise((resolve) =>
                    setTimeout(
                        () =>
                            resolve(
                                agentWrite({
                                    ctx,
                                    tool: "test",
                                    task,
                                    revision: task.getRevision(),
                                    label: "later",
                                    change: () => ({ result: { ok: true } }),
                                })
                            ),
                        10
                    )
                );
                return { result: {} };
            },
        });
        await expect(later).resolves.toMatchObject({ ok: true });
    });
});
