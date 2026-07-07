import { TaskOrchestrator } from "#base/task/orchestrator";
import { StatusType } from "#base/task/task-status";
import { DownloadTask } from "./utils/downloadTask";

/** Queue every candidate task and start processing. */
export async function runAll(): Promise<void> {
    const orchestrator = TaskOrchestrator.getInstance();
    if (!orchestrator.isProcessing()) {
        for (const task of orchestrator.getTasksCandidates()) {
            task.getStatus().set({ type: StatusType.Pending, message: "Queued" });
        }
    }
    orchestrator.processTasks();
}

/** Reset + queue the given tasks, then process only those ids. */
export async function runSelected(ids: Set<string>): Promise<void> {
    const orchestrator = TaskOrchestrator.getInstance();
    const tasks = orchestrator.getTasks() as unknown as DownloadTask[];
    for (const t of tasks) {
        if (!ids.has(t.getId())) continue;
        const state = t.getAttributes()?.state;
        if (state !== "pending" && state !== "stopped") {
            t.updateAttributes({
                state: "pending",
                metadataGroups: [],
                metadataOverride: {},
                downloadSources: [],
                primaryMetadataFetched: false,
                metadataDiscovered: false,
                downloadsFetched: false,
            });
            t.finishedAt = undefined;
            t.runnedAt = undefined;
        }
        t.getStatus().set({ type: StatusType.Pending, message: "Queued" });
    }
    // Pass the ID filter so the orchestrator only processes the selected tasks,
    // leaving other pending tasks untouched.
    orchestrator.processTasks(ids);
}

export async function stopAll(): Promise<void> {
    TaskOrchestrator.getInstance().stopProcessing();
}
