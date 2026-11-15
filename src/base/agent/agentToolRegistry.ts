import {
    AGENT_LOCK_NEEDS,
    AGENT_TOOL_KINDS,
    AgentToolError,
    type AgentToolContext,
    type AgentToolDefinition,
} from "./agentTool";
import { type AgentTurn } from "./agentTurn";
import { validateJsonSchema } from "./jsonSchema";
import { dialogBridge } from "#base/bridges/dialogBridge";

// A tool result larger than this is cut: the model reads it all, and the user's plan pays for every token.
export const MAX_RESULT_CHARS = 30_000;

const NAME_PATTERN = /^[a-z][a-z0-9_]{1,47}$/;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTool = AgentToolDefinition<any>;

/** What a call answers, as the MCP `tools/call` result: text for the model, flagged when it is an error. */
export type AgentToolOutcome = { text: string; isError: boolean };

/**
 * The one list of tools Claude can call. Every consumer reads it: the MCP server (`tools/list`, `tools/call`), the
 * CLI's `--allowedTools`, the catalogue printed by `yarn run agent:tools` and the committed `docs/agent-tools.md`.
 * Nothing else lists tools by hand.
 *
 * It knows nothing about music: the music tools are registered by `registerAgentTools()`.
 */
export class AgentToolRegistry {
    private tools = new Map<string, AnyTool>();
    // Turns the task id a tool was given into the id the task really has (a model may write it loosely).
    private canonicalTaskId: (taskId: string) => string = (taskId) => taskId;

    /**
     * How a `taskId` input names a task. The lease of a `locks: "task"` tool is taken on the id this returns, so it
     * covers the task the tool will change even when the model wrote its id differently (the flow decides how).
     */
    setTaskIdResolver(resolve: ((taskId: string) => string) | null): this {
        this.canonicalTaskId = resolve ?? ((taskId) => taskId);
        return this;
    }

    /** Adds a tool. A tool that is not fully described (summary, kind, input schema, locks) does not register. */
    register(tool: AnyTool): this {
        const problem = describeProblem(tool);
        if (problem) throw new Error(`Agent tool "${tool.name}" cannot register: ${problem}`);
        if (this.tools.has(tool.name)) throw new Error(`Agent tool "${tool.name}" is already registered`);
        this.tools.set(tool.name, tool);
        return this;
    }

    unregister(name: string): this {
        this.tools.delete(name);
        return this;
    }

    clear(): this {
        this.tools.clear();
        return this;
    }

    has(name: string): boolean {
        return this.tools.has(name);
    }

    get(name: string): AnyTool | undefined {
        return this.tools.get(name);
    }

    /** Every tool, in the order they were registered. */
    list(): AnyTool[] {
        return [...this.tools.values()];
    }

    /**
     * Runs a tool on behalf of a turn. Never throws: whatever goes wrong comes back as an error result the model
     * can read. The input is validated against the tool's own schema first (the model's output is untrusted), the
     * task named by a `locks: "task"` tool is leased for the call, and the lease is always given back.
     */
    async execute(name: string, rawInput: unknown, turn: AgentTurn): Promise<AgentToolOutcome> {
        const tool = this.tools.get(name);
        if (!tool) return failure(`Unknown tool "${name}".`);
        if (turn.isEnded || turn.signal.aborted) return failure("The user stopped this turn.");

        const input = rawInput ?? {};
        const problems = validateJsonSchema(tool.input, input);
        if (problems.length > 0) return failure(`Invalid input for ${name}: ${problems.join("; ")}`);

        const ctx: AgentToolContext = {
            signal: turn.signal,
            turn,
            // The question dies with the turn: after Stop (or the CLI giving up) it leaves the screen, answered "no".
            confirm: (dialog) => dialogBridge.confirm(dialog, { signal: turn.signal }),
        };

        let lease: { release(): void } | undefined;
        try {
            if (tool.locks === "task") {
                const taskId = (input as Record<string, unknown>).taskId;
                if (typeof taskId !== "string") return failure(`${name} needs a taskId.`);
                const got = turn.acquire([this.canonicalTaskId(taskId)], tool.leaseMs);
                if ("ended" in got) return failure("The user stopped this turn.");
                if ("heldBy" in got) {
                    return failure(`Task ${taskId} is being edited by someone else right now. Try again in a moment.`);
                }
                lease = got.lease;
            }
            const value = await tool.run(input, ctx);
            return { text: serialize(value), isError: false };
        } catch (error) {
            if (error instanceof AgentToolError) return failure(error.message);
            // Not one of ours: a bug. The model gets a short line; the details are for the log.
            return failure(`${name} failed: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            lease?.release();
        }
    }
}

function failure(text: string): AgentToolOutcome {
    return { text, isError: true };
}

function serialize(value: unknown): string {
    const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
    if (text.length <= MAX_RESULT_CHARS) return text;
    return `${text.slice(0, MAX_RESULT_CHARS)}\n…(cut at ${MAX_RESULT_CHARS} characters: ask for a narrower result or use the cursor)`;
}

/** Why a tool may not register; undefined when it is complete. */
export function describeProblem(tool: AnyTool): string | undefined {
    if (typeof tool.name !== "string" || !NAME_PATTERN.test(tool.name)) return "its name must be snake_case";
    if (typeof tool.summary !== "string" || tool.summary.trim() === "") return "it has no summary";
    if (!AGENT_TOOL_KINDS.includes(tool.kind)) return "it has no kind (read, write or confirm)";
    if (!AGENT_LOCK_NEEDS.includes(tool.locks)) return "it does not say what it locks";
    if (!tool.input || tool.input.type !== "object") return "it has no input schema (an object schema)";
    if (tool.locks === "task" && !(tool.input.required ?? []).includes("taskId")) {
        return 'a tool that locks "task" must require a taskId input';
    }
    if (tool.kind === "read" && tool.undoable) return "a read tool has nothing to undo";
    if (typeof tool.run !== "function") return "it has nothing to run";
    return undefined;
}

/** The app-wide registry. */
export const agentToolRegistry = new AgentToolRegistry();
