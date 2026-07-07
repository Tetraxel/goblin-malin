import { TaskOrchestrator } from "#base/task/orchestrator";
import { StatusType } from "#base/task/task-status";
import { DownloadTask } from "./utils/downloadTask";
import { CollectionTask } from "./utils/collectionTask";

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
    const tasks = orchestrator.getTasks();
    for (const t of tasks) {
        if (!ids.has(t.getId())) continue;
        const attrs = t.getAttributes() as { state?: string; kind?: string } | undefined;
        const state = attrs?.state;
        if (state !== "pending" && state !== "stopped") {
            if (attrs?.kind === "collection") {
                // Lighter reset than restart(): status/state only, existing children
                // (and their own state) are left untouched — a full teardown is
                // CollectionTask.restart()'s job, not a batch "run selected" reset.
                (t as unknown as CollectionTask).updateAttributes({ state: "pending", error: undefined });
            } else {
                (t as unknown as DownloadTask).updateAttributes({
                    state: "pending",
                    metadataGroups: [],
                    metadataOverride: {},
                    downloadSources: [],
                    primaryMetadataFetched: false,
                    metadataDiscovered: false,
                    downloadsFetched: false,
                });
            }
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
