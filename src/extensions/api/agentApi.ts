import { agentToolRegistry, describeProblem } from "#base/agent/agentToolRegistry";
import { AgentToolError, defineAgentTool, type AgentToolDefinition } from "#base/agent/agentTool";
import { type JsonSchema } from "#base/agent/jsonSchema";
import { agentWrite, requireDownloadTask } from "#flows/musicDownloadFlow/agent/taskAccess";
import { toolPrefix } from "../manifest";
import { createTrackEditor, ExtensionWriteError } from "./tasksApi";
import { type ExtensionToolDefinition } from "./types";

/** The name a tool of an extension has in the chat: `<extension>__<name>`. */
export function extensionToolName(extension: string, name: string): string {
    return `${toolPrefix(extension)}__${name}`;
}

/**
 * `goblin.agent.defineTool`: checks the declaration exactly as `defineAgentTool` does (summary, schema, kind, locks),
 * prefixes the name, and registers it. Its `ctx.write` goes through `agentWrite()`, so the turn's budget, the
 * revision check and the lock work as for the app's own tools. An extension tool cannot be undone by `/undo` (it
 * says nothing about what to put back), and its summary says which extension it comes from.
 */
export function defineExtensionTool(
    extension: string,
    displayName: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    def: ExtensionToolDefinition<any>
): string {
    if (!def || typeof def !== "object") throw new Error("defineTool needs a tool definition");
    if (typeof def.name !== "string" || !/^[a-z][a-z0-9_]{0,40}$/.test(def.name)) {
        throw new Error(`Tool "${String(def.name)}": its name must be snake_case`);
    }
    const name = extensionToolName(extension, def.name);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tool: AgentToolDefinition<any> = defineAgentTool({
        name,
        summary: `(from the extension "${displayName}") ${def.summary ?? ""}`.trim(),
        kind: def.kind,
        locks: def.locks,
        undoable: false,
        input: def.input as JsonSchema & { type: "object" },
        example: def.example,
        describeCall: () => name,
        run: async (input, ctx) => {
            try {
                return await def.run(input, {
                    signal: ctx.signal,
                    confirm: (dialog) => ctx.confirm(dialog),
                    write: (taskId, revision, label, change) =>
                        agentWrite({
                            ctx,
                            tool: name,
                            task: requireDownloadTask(taskId),
                            revision,
                            label: `${name} → ${label}`,
                            change: async (as) => {
                                const editor = createTrackEditor(taskId, {
                                    actor: as.actor ?? "agent",
                                    guard: async (_task, fn) => fn(),
                                });
                                const result = await change(editor);
                                return { result: (result ?? {}) as object };
                            },
                        }) as never,
                });
            } catch (error) {
                // What the model should read: our own refusals keep their words.
                if (error instanceof ExtensionWriteError) throw new AgentToolError(error.message, error.code);
                throw error;
            }
        },
    });
    if (tool.summary === `(from the extension "${displayName}")`) throw new Error(`Tool "${def.name}" has no summary`);
    const problem = describeProblem(tool);
    if (problem) throw new Error(`Tool "${def.name}" cannot register: ${problem}`);
    agentToolRegistry.register(tool);
    return name;
}
