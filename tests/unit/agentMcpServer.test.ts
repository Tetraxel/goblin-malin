import { afterEach, beforeEach, describe, expect, test } from "vitest";
import http from "node:http";
import { AgentMcpServer } from "#base/agent/mcpServer";
import { AgentToolRegistry } from "#base/agent/agentToolRegistry";
import { AgentTurn } from "#base/agent/agentTurn";
import { defineAgentTool } from "#base/agent/agentTool";
import { TaskLocks } from "#base/task/taskLock";

const TOKEN = "tok-live";

let server: AgentMcpServer;
let turn: AgentTurn;
let calls: unknown[];

beforeEach(async () => {
    calls = [];
    turn = new AgentTurn(new TaskLocks());
    const registry = new AgentToolRegistry().register(
        defineAgentTool<{ word: string }>({
            name: "echo_word",
            summary: "Echoes.",
            kind: "read",
            locks: "none",
            undoable: false,
            input: { type: "object", required: ["word"], properties: { word: { type: "string" } } },
            run: ({ word }) => {
                calls.push(word);
                return { shouted: word.toUpperCase() };
            },
        })
    );
    server = new AgentMcpServer({
        registry,
        authenticate: (t) => (t === TOKEN ? turn : undefined),
    });
    await server.start();
});

afterEach(async () => {
    await server.stop();
});

type Reply = { status: number; body: any };

/** One raw HTTP request, so headers a browser or a client would not normally send can be set. */
function request(options: {
    method?: string;
    path?: string;
    headers?: Record<string, string>;
    body?: unknown;
    host?: string;
}): Promise<Reply> {
    const url = new URL(server.url);
    const payload = options.body === undefined ? undefined : JSON.stringify(options.body);
    return new Promise((resolve, reject) => {
        const req = http.request(
            {
                host: "127.0.0.1",
                port: url.port,
                // A connection of its own: one the server closed must not be reused by the next request.
                agent: false,
                method: options.method ?? "POST",
                path: options.path ?? "/mcp",
                headers: {
                    "Content-Type": "application/json",
                    ...(options.host ? { Host: options.host } : {}),
                    ...(payload ? { "Content-Length": String(Buffer.byteLength(payload)) } : {}),
                    ...options.headers,
                },
            },
            (res) => {
                let data = "";
                res.on("data", (c) => (data += c));
                res.on("end", () => {
                    let body: unknown = data;
                    try {
                        body = data ? JSON.parse(data) : undefined;
                    } catch {
                        /* not JSON */
                    }
                    resolve({ status: res.statusCode ?? 0, body });
                });
            }
        );
        req.on("error", reject);
        if (payload) req.write(payload);
        req.end();
    });
}

const rpc = (method: string, params?: unknown) => ({ jsonrpc: "2.0", id: 1, method, params });
const authed = { Authorization: `Bearer ${TOKEN}` };

describe("AgentMcpServer", () => {
    test("initialize, list and call a tool", async () => {
        const init = await request({ headers: authed, body: rpc("initialize", { protocolVersion: "2025-06-18" }) });
        expect(init.status).toBe(200);
        expect(init.body.result).toMatchObject({ protocolVersion: "2025-06-18", capabilities: { tools: {} } });

        const list = await request({ headers: authed, body: rpc("tools/list") });
        expect(list.body.result.tools).toHaveLength(1);
        expect(list.body.result.tools[0]).toMatchObject({
            name: "echo_word",
            description: "Echoes.",
            annotations: { readOnlyHint: true },
        });

        const call = await request({
            headers: authed,
            body: rpc("tools/call", { name: "echo_word", arguments: { word: "goblin" } }),
        });
        expect(call.body.result).toEqual({ content: [{ type: "text", text: '{"shouted":"GOBLIN"}' }], isError: false });
    });

    test("a tool that does not exist comes back as an error the model can read", async () => {
        const call = await request({ headers: authed, body: rpc("tools/call", { name: "nope", arguments: {} }) });
        expect(call.body.result.isError).toBe(true);
        expect(call.body.result.content[0].text).toMatch(/Unknown tool/);
    });

    test("initialize answers a version the server speaks, never one it does not", async () => {
        const older = await request({ headers: authed, body: rpc("initialize", { protocolVersion: "2025-03-26" }) });
        expect(older.body.result.protocolVersion).toBe("2025-03-26");

        const future = await request({ headers: authed, body: rpc("initialize", { protocolVersion: "2099-01-01" }) });
        expect(future.body.result.protocolVersion).toBe("2025-06-18");

        const none = await request({ headers: authed, body: rpc("initialize", {}) });
        expect(none.body.result.protocolVersion).toBe("2025-06-18");
    });

    test("a bad input comes back as an error the model can read, and the tool never ran", async () => {
        const call = await request({
            headers: authed,
            body: rpc("tools/call", { name: "echo_word", arguments: { word: 3 } }),
        });
        expect(call.body.result.isError).toBe(true);
        expect(calls).toEqual([]);
    });

    test("notifications get no answer", async () => {
        const res = await request({ headers: authed, body: { jsonrpc: "2.0", method: "notifications/initialized" } });
        expect(res.status).toBe(202);
    });

    test("no token, a wrong token, or the token of a finished turn: 401", async () => {
        expect((await request({ body: rpc("tools/list") })).status).toBe(401);
        expect((await request({ headers: { Authorization: "Bearer nope" }, body: rpc("tools/list") })).status).toBe(
            401
        );
        turn.end();
        expect((await request({ headers: authed, body: rpc("tools/list") })).status).toBe(401);
    });

    test("a request for another host is refused (DNS rebinding)", async () => {
        const res = await request({ headers: authed, host: "evil.example", body: rpc("tools/list") });
        expect(res.status).toBe(403);
    });

    test("a request from a web page (it carries an Origin) is refused", async () => {
        const res = await request({ headers: { ...authed, Origin: "https://evil.example" }, body: rpc("tools/list") });
        expect(res.status).toBe(403);
    });

    test("only POST on /mcp", async () => {
        expect((await request({ method: "GET", headers: authed })).status).toBe(405);
        expect((await request({ path: "/elsewhere", headers: authed, body: rpc("ping") })).status).toBe(404);
    });

    test("garbage and oversized bodies do not crash it", async () => {
        const garbage = await new Promise<number>((resolve, reject) => {
            const req = http.request(
                {
                    host: "127.0.0.1",
                    port: new URL(server.url).port,
                    agent: false,
                    method: "POST",
                    path: "/mcp",
                    headers: authed,
                },
                (res) => {
                    res.resume();
                    resolve(res.statusCode ?? 0);
                }
            );
            req.on("error", reject);
            req.end("{not json");
        });
        expect(garbage).toBe(400);
        const big = await request({ headers: authed, body: { pad: "x".repeat(1_200_000) } }).catch(() => ({
            status: 413,
        }));
        expect([413, 400]).toContain(big.status);
        expect((await request({ headers: authed, body: rpc("ping") })).body.result).toEqual({});
    });

    test("the server stops, and a stopped server is not reachable", async () => {
        await server.stop();
        expect(server.isRunning).toBe(false);
        await expect(request({ headers: authed, body: rpc("ping") })).rejects.toThrow();
    });
});
