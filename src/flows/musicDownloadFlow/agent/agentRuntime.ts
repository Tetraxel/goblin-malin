import { randomBytes } from "node:crypto";
import { AgentMcpServer } from "#base/agent/mcpServer";
import { agentToolRegistry } from "#base/agent/agentToolRegistry";
import { AgentTurn } from "#base/agent/agentTurn";
import { registerAgentCleanup } from "#base/agent/cleanup";
import { APP_VERSION } from "#constants";

/** How many chat turns may run at once. One message at a time: Claude's answer to the next depends on this one. */
export const MAX_PARALLEL_TURNS = 1;

/**
 * The agent's server and its turns. One MCP server for the whole launch (started with the first message, closed with
 * the app); a new bearer token for every turn, so a token a finished turn leaves behind opens nothing.
 */
export class AgentRuntime {
    private readonly server: AgentMcpServer;
    private readonly turns = new Map<string, AgentTurn>();
    private forgetCleanup?: () => void;

    constructor(registry = agentToolRegistry) {
        this.server = new AgentMcpServer({
            registry,
            serverName: "goblin-malin",
            serverVersion: APP_VERSION,
            authenticate: (token) => this.turns.get(token),
        });
    }

    /** The address the CLI is pointed at (valid once {@link beginTurn} has resolved). */
    get url(): string {
        return this.server.url;
    }

    get activeTurns(): number {
        return this.turns.size;
    }

    /** Starts the server if needed and opens a turn. Throws when a turn is already running. */
    async beginTurn(): Promise<{ turn: AgentTurn; token: string }> {
        if (this.turns.size >= MAX_PARALLEL_TURNS) throw new Error("Claude is already answering");
        if (!this.server.isRunning) {
            await this.server.start();
            this.forgetCleanup = registerAgentCleanup(() => this.stop());
        }
        const turn = new AgentTurn();
        const token = randomBytes(32).toString("hex");
        this.turns.set(token, turn);
        return { turn, token };
    }

    /** Closes a turn: its token stops working, its leases are given back, anything still running is aborted. */
    endTurn(token: string): void {
        const turn = this.turns.get(token);
        this.turns.delete(token);
        turn?.end();
    }

    async stop(): Promise<void> {
        for (const turn of this.turns.values()) turn.end();
        this.turns.clear();
        this.forgetCleanup?.();
        this.forgetCleanup = undefined;
        await this.server.stop();
    }
}

export const agentRuntime = new AgentRuntime();
