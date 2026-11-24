/**
 * The process behind an interactive session (`sessionCli.ts start`): one app kept running in a pseudo-terminal, and a
 * small HTTP server on 127.0.0.1 that runs steps against it and returns the screen. It lets a person (or Claude) press
 * a key, read the screen, decide, and press the next one, instead of writing a whole scenario blind.
 *
 * Started detached by the CLI with the path of a JSON config: `{ name, scenario }` (the scenario's steps are ignored).
 * It stops on `POST /stop`, when the app has exited and a minute has passed, or after 20 minutes without a request.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { TuiSession } from "./session.ts";
import { SESSIONS_DIR, type SessionRecord } from "./sessionShared.ts";
import { StepRunner } from "./steps.ts";
import { buildReport, formatFailure } from "./runner.ts";
import { findAll, type TextMatch } from "./matchers.ts";
import type { Scenario, Step } from "./types.ts";

const IDLE_STOP_MS = 20 * 60 * 1000;

async function main(): Promise<void> {
    const configPath = process.argv[2];
    if (!configPath) throw new Error("usage: sessionServer.ts <config.json>");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8")) as { name: string; scenario: Scenario };
    const scenario: Scenario = { ...config.scenario, steps: [] };

    const session = new TuiSession(scenario);
    const runner = new StepRunner(session, { scenario, emit: () => undefined });

    const token = randomBytes(16).toString("hex");
    const recordFile = path.join(SESSIONS_DIR, `${config.name}.json`);
    let idleTimer: NodeJS.Timeout | undefined;
    let busy: Promise<unknown> = Promise.resolve();

    const stop = async (): Promise<void> => {
        clearTimeout(idleTimer);
        server.close();
        await session.dispose();
        fs.rmSync(recordFile, { force: true });
        process.exit(0);
    };
    const touch = (): void => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => void stop(), IDLE_STOP_MS);
    };

    const view = async (): Promise<Record<string, unknown>> => {
        await session.emulator.flush();
        return {
            screen: session.emulator.readScreen(),
            cols: session.cols,
            rows: session.rows,
            cursor: session.emulator.cursor(),
            exited: session.exited,
            exitCode: session.appExitCode,
        };
    };

    /** Runs the steps one after the other (requests are queued: the app has one screen), then lets it settle. */
    const runSteps = async (steps: Step[], settle: boolean): Promise<Record<string, unknown>> => {
        let error: string | undefined;
        for (const [index, step] of steps.entries()) {
            try {
                await runner.run(step);
            } catch (e) {
                const report = await buildReport(session, index, step, e);
                error = formatFailure(report, false);
                break;
            }
        }
        if (settle && !error && !session.exited) await session.waitForStable(8000, 250, 0);
        return { ok: error === undefined, error, ...(await view()) };
    };

    const readBody = (req: http.IncomingMessage): Promise<string> =>
        new Promise((resolve, reject) => {
            let body = "";
            req.on("data", (chunk: Buffer) => (body += chunk.toString("utf-8")));
            req.on("end", () => resolve(body));
            req.on("error", reject);
        });

    const server = http.createServer((req, res) => {
        const reply = (status: number, body: unknown): void => {
            res.writeHead(status, { "content-type": "application/json" });
            res.end(JSON.stringify(body));
        };
        if (req.headers["x-token"] !== token) return reply(403, { ok: false, error: "bad token" });
        touch();
        const url = new URL(req.url ?? "/", "http://127.0.0.1");

        // One request at a time: they press keys on the same screen.
        const queued = busy.then(async () => {
            try {
                if (req.method === "GET" && url.pathname === "/screen") return reply(200, await view());
                if (req.method === "GET" && url.pathname === "/ansi") {
                    await session.emulator.flush();
                    return reply(200, { screen: session.emulator.readScreenAnsi() });
                }
                if (req.method === "POST" && url.pathname === "/steps") {
                    const body = JSON.parse((await readBody(req)) || "{}") as { steps?: Step[]; settle?: boolean };
                    return reply(200, await runSteps(body.steps ?? [], body.settle !== false));
                }
                if (req.method === "POST" && url.pathname === "/find") {
                    const match = JSON.parse((await readBody(req)) || "{}") as TextMatch;
                    await session.emulator.flush();
                    return reply(200, { ok: true, found: findAll(session.emulator.readLines(), match) });
                }
                if (req.method === "POST" && url.pathname === "/stop") {
                    reply(200, { ok: true });
                    return void setTimeout(() => void stop(), 50);
                }
                return reply(404, { ok: false, error: `no such endpoint ${req.method} ${url.pathname}` });
            } catch (error) {
                return reply(500, { ok: false, error: error instanceof Error ? error.message : String(error) });
            }
        });
        busy = queued.catch(() => undefined);
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    // Boot: wait for the first frames before anyone is told the session exists.
    await session.waitForStable(30000, 400, 1000);

    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    const record: SessionRecord = { name: config.name, pid: process.pid, port, token, startedAt: Date.now() };
    fs.writeFileSync(recordFile, JSON.stringify(record));
    touch();

    // An app that quit keeps its last screen for a minute, then the session goes.
    void session.waitForExit(IDLE_STOP_MS).then((exited) => {
        if (exited) setTimeout(() => void stop(), 60_000);
    });
    process.on("SIGINT", () => void stop());
    process.on("SIGTERM", () => void stop());
}

main().catch((error) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exit(1);
});
