import { type JsonSchema } from "./jsonSchema";
import { type AgentTurn } from "./agentTurn";
import { type ConfirmDialog } from "#base/bridges/dialogBridge";

/**
 * - `read`: looks, changes nothing.
 * - `write`: changes the user's data, through a named method that validates it (and can usually be undone).
 * - `confirm`: always asks the user first, whatever the model says; "not done" when nobody answers.
 */
export type AgentToolKind = "read" | "write" | "confirm";

/** What a tool must hold while it runs: nothing, the one task named by its `taskId` input, or a set it picks itself. */
export type AgentLockNeed = "none" | "task" | "tasks";

export const AGENT_TOOL_KINDS: readonly AgentToolKind[] = ["read", "write", "confirm"];
export const AGENT_LOCK_NEEDS: readonly AgentLockNeed[] = ["none", "task", "tasks"];

/** What a tool gets besides its (already validated) input. */
export interface AgentToolContext {
    /** Aborted when the user presses Stop (or the turn ends). A long tool must stop soon after. */
    signal: AbortSignal;
    /** The conversation turn that made this call: budgets and leases live there. */
    turn: AgentTurn;
    /** Asks the user (safe button first). Resolves null when dismissed, when no UI is mounted, or when the turn ends first. */
    confirm(dialog: ConfirmDialog): Promise<number | null>;
}

/** A failure the model should read and act on (wrong id, stale revision, task is running…). */
export class AgentToolError extends Error {
    constructor(
        message: string,
        /** A short machine-readable reason ("stale", "locked", "running", "not-found", "budget"…). */
        public readonly code = "failed"
    ) {
        super(message);
        this.name = "AgentToolError";
    }
}

export interface AgentToolDefinition<TInput = Record<string, unknown>> {
    /** `snake_case`, unique. Shown to the model as `mcp__<server>__<name>`. */
    name: string;
    /** One line, for the model and for the catalogue. */
    summary: string;
    kind: AgentToolKind;
    /** Plain JSON Schema of the input object. Every call is validated against it before `run`. */
    input: JsonSchema & { type: "object" };
    locks: AgentLockNeed;
    /** Whether "Undo Claude's last action" can revert it. */
    undoable: boolean;
    /** How long the lease on the task lasts if the call never ends (default: a minute). A slow tool asks for more. */
    leaseMs?: number;
    /** One example input, for the generated documentation. */
    example?: Record<string, unknown>;
    /** The line shown live in the chat while it runs ("select_source → Track X"). */
    describeCall?: (input: TInput) => string;
    /** Returns something JSON-serialisable (or a string). Throw {@link AgentToolError} to tell the model what went wrong. */
    run: (input: TInput, ctx: AgentToolContext) => Promise<unknown> | unknown;
}

/**
 * Declares a tool. It is a plain identity function, so a definition is type-checked where it is written; the tool
 * becomes available to the agent when it is passed to `agentToolRegistry.register()`.
 */
export function defineAgentTool<TInput = Record<string, unknown>>(
    definition: AgentToolDefinition<TInput>
): AgentToolDefinition<TInput> {
    return definition;
}
