import { agentToolRegistry } from "#base/agent/agentToolRegistry";
import { readTools } from "./tools/readTools";
import { batchTools } from "./tools/batchTools";
import { writeTools, archiveTasks } from "./tools/writeTools";
import { runTools } from "./tools/runTools";
import { reportTools } from "./tools/reportTools";
import { stemTools } from "./tools/stemTools";
import { findTask } from "./taskAccess";

/**
 * Puts the music tools in the agent's registry. Called by `initMusicApp()`, and by `yarn run agent:tools` and the
 * stale-doc test, which must never call `initMusicApp()` itself (it starts the live-playlist scheduler).
 * Safe to call twice.
 */
export function registerAgentTools(): void {
    // The order of the generated catalogue: the reads, then the writes, then the batch tools, and the one that
    // always asks last. Each list is registered as it is written, so a new tool needs no change here.
    const ordered = [
        ...readTools,
        ...reportTools,
        ...writeTools.filter((t) => t !== archiveTasks),
        ...runTools,
        ...stemTools,
        ...batchTools,
        archiveTasks,
    ];
    for (const tool of ordered) {
        if (!agentToolRegistry.has(tool.name)) agentToolRegistry.register(tool);
    }
    // A lease must cover the task the tool changes, also when the model dropped the "task:" prefix.
    agentToolRegistry.setTaskIdResolver((taskId) => findTask(taskId)?.getId() ?? taskId);
}
