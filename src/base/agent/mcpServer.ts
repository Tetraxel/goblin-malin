import http from "node:http";
import { type AddressInfo } from "node:net";
import { type AgentToolRegistry } from "./agentToolRegistry";
import { type AgentTurn } from "./agentTurn";
import { globalLogger } from "#base/logger/logger";

/**
 * A tiny MCP server (Streamable HTTP, JSON responses only) that lives inside the app process, so Claude goes
 * THROUGH the running app and never around it. Hand-rolled on purpose: the protocol surface the agent needs is
 * three requests (`initialize`, `tools/list`, `tools/call`), the tools describe their input as plain JSON Schema
 * already, and the official SDK would bring zod 4 next to the zod 3 that ytmusic-api needs.
 *
 * Who may talk to it:
 *  - only the loopback interface, on a random port;
 *  - every request must carry the bearer token of a live turn (a new token per message of the chat);
 *  - the `Host` header must be this very address (the guard against DNS rebinding) and there must be no
 *    `Origin` header (a web page in the user's browser sends one; the CLI does not).
 */

// The MCP revisions this server speaks, newest first. `initialize` answers the client's own version when it is one of
// these, and the newest otherwise (the client then decides whether it can go on).
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];
const MAX_BODY_BYTES = 1_000_000;

type JsonRpcId = string | number | null;
type JsonRpcRequest = { jsonrpc?: string; id?: JsonRpcId; method?: string; params?: Record<string, unknown> };

export interface McpServerOptions {
    registry: AgentToolRegistry;
    /** Maps a bearer token to the turn it belongs to; undefined for an unknown or finished turn. */
    authenticate: (token: string) => AgentTurn | undefined;
    serverName?: string;
    serverVersion?: string;
    /** Called for every tool call, before it runs (the chat shows it live). */
    onToolCall?: (turn: AgentTurn, name: string, input: unknown) => void;
    /** Called with the outcome of every tool call. */
    onToolResult?: (turn: AgentTurn, name: string, outcome: { text: string; isError: boolean }) => void;
}

export class AgentMcpServer {
    private server?: http.Server;
    private port = 0;
    private readonly logger = globalLogger.createChild({ service: "AgentMcpServer" });

    constructor(private readonly options: McpServerOptions) {}

    get isRunning(): boolean {
        return this.server?.listening === true;
    }

    /** The URL the CLI is pointed at. Only valid once started. */
    get url(): string {
        return `http://127.0.0.1:${this.port}/mcp`;
    }

    async start(): Promise<void> {
        if (this.server) return;
        const server = http.createServer((req, res) => {
            void this.handle(req, res).catch((error) => {
                this.logger.warn("MCP request failed", { error });
                if (!res.headersSent) send(res, 500, { error: "internal error" });
            });
        });
        // A client that opens a connection and says nothing must not hold it for ever.
        server.headersTimeout = 10_000;
        server.requestTimeout = 0; // a tool call may legitimately take minutes (a dialog waiting for the user)
        await new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen(0, "127.0.0.1", () => {
                server.off("error", reject);
                resolve();
            });
        });
        this.server = server;
        this.port = (server.address() as AddressInfo).port;
        this.logger.info(`Agent MCP server listening on 127.0.0.1:${this.port}`);
    }

    async stop(): Promise<void> {
        const server = this.server;
        if (!server) return;
        this.server = undefined;
        await new Promise<void>((resolve) => {
            server.close(() => resolve());
            server.closeAllConnections();
        });
    }

    private hostAllowed(host: string | undefined): boolean {
        if (!host) return false;
        const allowed = [`127.0.0.1:${this.port}`, `localhost:${this.port}`, `[::1]:${this.port}`];
        return allowed.includes(host.toLowerCase());
    }

    private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        if (!this.hostAllowed(req.headers.host)) return send(res, 403, { error: "forbidden host" });
        // A browser tab (a DNS-rebinding page, or any site) always adds Origin. The CLI never does.
        if (req.headers.origin !== undefined) return send(res, 403, { error: "forbidden origin" });
        if (new URL(req.url ?? "/", "http://x").pathname !== "/mcp") return send(res, 404, { error: "not found" });

        const turn = this.authenticate(req.headers.authorization);
        if (!turn) return send(res, 401, { error: "unauthorized" });

        // Streamable HTTP lets a server stream over GET; this one answers every request in the POST itself.
        if (req.method !== "POST") {
            res.setHeader("Allow", "POST");
            return send(res, 405, { error: "method not allowed" });
        }

        const body = await readBody(req);
        if (body === undefined) {
            // The rest of the body is still coming: close the connection instead of reading it.
            res.setHeader("Connection", "close");
            return send(res, 413, { error: "request too large" });
        }
        let message: unknown;
        try {
            message = JSON.parse(body);
        } catch {
            return send(res, 400, rpcError(null, -32700, "parse error"));
        }

        if (Array.isArray(message)) {
            const answers = (await Promise.all(message.map((m) => this.dispatch(m as JsonRpcRequest, turn)))).filter(
                (a) => a !== undefined
            );
            return answers.length === 0 ? sendEmpty(res) : send(res, 200, answers);
        }
        const answer = await this.dispatch(message as JsonRpcRequest, turn);
        return answer === undefined ? sendEmpty(res) : send(res, 200, answer);
    }

    private authenticate(header: string | undefined): AgentTurn | undefined {
        const match = /^Bearer (.+)$/.exec(header ?? "");
        if (!match) return undefined;
        const turn = this.options.authenticate(match[1]);
        return turn && !turn.isEnded ? turn : undefined;
    }

    /** One JSON-RPC message. Returns what to answer, or undefined for a notification (no answer). */
    private async dispatch(message: JsonRpcRequest, turn: AgentTurn): Promise<unknown> {
        if (!message || typeof message !== "object" || typeof message.method !== "string") {
            return rpcError(message?.id ?? null, -32600, "invalid request");
        }
        const id = message.id;
        if (id === undefined) return undefined; // a notification ("notifications/initialized", "…/cancelled")

        switch (message.method) {
            case "initialize": {
                const asked = message.params?.protocolVersion;
                return rpcResult(id, {
                    protocolVersion:
                        typeof asked === "string" && SUPPORTED_PROTOCOL_VERSIONS.includes(asked)
                            ? asked
                            : PROTOCOL_VERSION,
                    capabilities: { tools: { listChanged: false } },
                    serverInfo: {
                        name: this.options.serverName ?? "goblin-malin",
                        version: this.options.serverVersion ?? "0",
                    },
                });
            }
            case "ping":
                return rpcResult(id, {});
            case "tools/list": {
                const tools = this.options.registry.list().map((t) => ({
                    name: t.name,
                    description: t.summary,
                    inputSchema: t.input,
                    annotations: { readOnlyHint: t.kind === "read", openWorldHint: false },
                }));
                return rpcResult(id, { tools });
            }
            case "tools/call": {
                const name = message.params?.name;
                if (typeof name !== "string") return rpcError(id, -32602, "tools/call needs a tool name");
                const input = message.params?.arguments;
                this.options.onToolCall?.(turn, name, input);
                const outcome = await this.options.registry.execute(name, input, turn);
                this.options.onToolResult?.(turn, name, outcome);
                return rpcResult(id, toolResult(outcome));
            }
            default:
                return rpcError(id, -32601, `method not found: ${message.method}`);
        }
    }
}

function toolResult(outcome: { text: string; isError: boolean }) {
    return { content: [{ type: "text", text: outcome.text }], isError: outcome.isError };
}

function rpcResult(id: JsonRpcId, result: unknown) {
    return { jsonrpc: "2.0", id, result };
}

function rpcError(id: JsonRpcId, code: number, message: string) {
    return { jsonrpc: "2.0", id, error: { code, message } };
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
    const text = JSON.stringify(body);
    res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
    res.end(text);
}

function sendEmpty(res: http.ServerResponse): void {
    res.writeHead(202);
    res.end();
}

async function readBody(req: http.IncomingMessage): Promise<string | undefined> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
        size += (chunk as Buffer).length;
        if (size > MAX_BODY_BYTES) return undefined;
        chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks).toString("utf8");
}
