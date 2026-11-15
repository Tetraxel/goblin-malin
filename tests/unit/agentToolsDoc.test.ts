import { describe, expect, test } from "vitest";
import fs from "node:fs";
import { agentToolRegistry } from "#base/agent/agentToolRegistry";
import { describeProblem } from "#base/agent/agentToolRegistry";
import { AGENT_TOOLS_DOC_PATH, generateAgentToolsDoc, loadAgentTools } from "../../scripts/agentToolsDoc";

describe("the agent tool catalogue", () => {
    test("every tool has a kind, an input schema, a summary and an example", async () => {
        const tools = await loadAgentTools();
        expect(tools.length).toBeGreaterThan(10);
        for (const tool of tools) {
            expect(describeProblem(tool), tool.name).toBeUndefined();
            expect(tool.example, `${tool.name} needs an example for the docs`).toBeDefined();
        }
    });

    test("tools that change data say how: every write is a named method call that can be undone or is flagged", async () => {
        const tools = await loadAgentTools();
        const writes = tools.filter((t) => t.kind !== "read");
        expect(writes.map((t) => t.name).sort()).toEqual(
            [
                "add_tasks",
                "add_user_source",
                "apply_batch",
                "archive_tasks",
                "rediscover",
                "reject_source",
                "run_download",
                "run_metadata",
                "run_task",
                "select_source",
                "set_metadata_override",
            ].sort()
        );
        // What the user cannot take back with /undo must go through a dialog or be slow and explicit.
        for (const tool of writes.filter((t) => !t.undoable)) {
            expect(["archive_tasks", "rediscover", "run_metadata", "run_download", "run_task"]).toContain(tool.name);
        }
        // Anything that downloads asks first.
        for (const name of ["run_download", "run_task"]) {
            expect(tools.find((t) => t.name === name)?.kind, name).toBe("confirm");
        }
        // Claude starts tasks, but never saves a file to the music folder and never deletes.
        const names = tools.map((t) => t.name);
        for (const forbidden of ["save_tasks", "delete_tasks", "save_track"]) {
            expect(names).not.toContain(forbidden);
        }
    });

    test("docs/agent-tools.md is the registry, formatted: refresh it with `yarn run agent:tools --write`", async () => {
        await loadAgentTools();
        expect(agentToolRegistry.list().length).toBeGreaterThan(0);
        const committed = fs.readFileSync(AGENT_TOOLS_DOC_PATH, "utf8").replace(/\r\n/g, "\n");
        expect(committed).toBe(await generateAgentToolsDoc());
    });
});
