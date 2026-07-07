import { globalLogger, Logger } from "../logger/logger";
import { notificationScheduler } from "../notificationScheduler";
import { Task } from "./task";
import { StatusType } from "./task-status";

type OrchestratorSubscriber = (orchestrator: TaskOrchestrator) => void;

/**
 * The task engine: holds the task queue and runs it with a completion-driven
 * pump under a global concurrency cap. Purely generic over Task — it knows
 * nothing about what the tasks do.
 */
export class TaskOrchestrator {
    public readonly id = "task-orchestrator";
    private static instance: TaskOrchestrator;
    private globalMaxConcurrent: number = 3;
    private logger: Logger;
    private subscribers: Set<OrchestratorSubscriber> = new Set();
    private tasks: Task[] = [];
    // Mirror of `tasks` ids for O(1) membership checks (import dedup) instead of the
    // O(n) `find` this used to do per added task (O(n²) on a bulk import).
    private taskIds: Set<string> = new Set();
    // Tasks removed while running — kept here so getTasksInProgress() still
    // counts their concurrency slot until the background promise finishes.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private removingTasks: Set<Task<any>> = new Set();
    private processing: boolean = false;
    private stopping: boolean = false;
    private abortController?: AbortController;

    private constructor() {
        this.logger = globalLogger.createChild({ service: "TaskOrchestrator" });
    }

    static getInstance(): TaskOrchestrator {
        if (!TaskOrchestrator.instance) {
            TaskOrchestrator.instance = new TaskOrchestrator();
        }
        return TaskOrchestrator.instance;
    }

    // ============ TASK QUEUE MANAGEMENT ============

    setGlobalMaxConcurrent(max: number): void {
        const next = Math.max(1, Math.floor(max));
        if (next === this.globalMaxConcurrent) return;
        this.globalMaxConcurrent = next;
        this.notifySubscribers();
    }

    getGlobalMaxConcurrent(): number {
        return this.globalMaxConcurrent;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    addTasks(tasks: Task<any>[]): void {
        // O(1) duplicate check against the id mirror instead of scanning `this.tasks`.
        for (const task of tasks) {
            if (this.taskIds.has(task.getId())) {
                throw new Error(`Task ${task.getId()} is already in the queue`);
            }
        }

        this.tasks = this.tasks.concat(tasks);
        for (const task of tasks) this.taskIds.add(task.getId());
        this.notifySubscribers();
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setTasks(tasks: Task<any>[]): void {
        this.tasks = [...tasks];
        this.taskIds = new Set(tasks.map((t) => t.getId()));
        this.removingTasks.clear();
        this.notifySubscribers();
    }

    public getTasks(): Task[] {
        return this.tasks;
    }

    public removeTasks(ids: string[]): void {
        const idSet = new Set(ids);
        for (const task of this.tasks) {
            if (idSet.has(task.getId()) && task.running) {
                // Task is mid-flight — hold its slot until the promise finishes.
                this.removingTasks.add(task);
            }
        }
        this.tasks = this.tasks.filter((t) => !idSet.has(t.getId()));
        for (const id of ids) this.taskIds.delete(id);
        this.notifySubscribers();
    }

    public getTasksCandidates(): Task[] {
        return this.tasks.filter((task) => !task.running && task.finishedAt == undefined);
    }

    public getTasksInProgress(): Task[] {
        // Drop any removing tasks whose promise has finished.
        for (const t of this.removingTasks) {
            if (!t.running) this.removingTasks.delete(t);
        }
        return [...this.tasks.filter((task) => task.running), ...Array.from(this.removingTasks)];
    }

    /** In-progress count without materializing the array (hot path in the pump). */
    private countInProgress(): number {
        for (const t of this.removingTasks) {
            if (!t.running) this.removingTasks.delete(t);
        }
        let count = this.removingTasks.size;
        for (const task of this.tasks) if (task.running) count++;
        return count;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public async processTask(task: Task<any>, signal?: AbortSignal): Promise<void> {
        // Clean attributes in case the task is restarted
        return task
            .start(signal)
            .then(() => {
                task.success = true;
            })
            .catch((error: Error) => {
                if (error.name === "AbortError") return;
                task.getStatus().set({
                    type: StatusType.Error,
                    message: "Failed to process task",
                });
                task.getLogger().error(
                    `Failed to process ${task.getId()} ${task.getInitialInput()}: ${error.message}`,
                    { stack: error.stack }
                );
            })
            .finally(() => {
                task.running = false;
                // Stopped tasks keep finishedAt=undefined so they remain candidates for the next run
                if (task.getAttributes()?.state !== "stopped") {
                    task.finishedAt = new Date();
                }
            });
    }

    /**
     * Event-driven task pump. Tasks are started up to `globalMaxConcurrent`, and each
     * task's completion drives the next dispatch via its `.finally` — so the loop
     * sleeps when idle (zero wakeups, zero no-op notifications) and reacts the instant
     * a slot frees. Subscribers are notified only on real transitions (batch start,
     * new launches, and batch completion).
     */
    public async processTasks(filterIds?: Set<string>): Promise<void> {
        if (this.processing) {
            this.logger.warn("processTasks already running — ignoring duplicate call");
            return;
        }

        this.processing = true;
        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        const candidates = (): Task[] => {
            const all = this.getTasksCandidates();
            return filterIds ? all.filter((t) => filterIds.has(t.getId())) : all;
        };

        this.logger.info(`Processing ${candidates().length} tasks`);
        this.notifySubscribers();

        return new Promise<void>((resolve) => {
            let finished = false;

            const settle = (): void => {
                if (finished) return;
                finished = true;
                this.clearQueuedStatus();
                this.processing = false;
                this.stopping = false;
                this.abortController = undefined;
                this.notifySubscribers();
                resolve();
            };

            const maybeFinish = (): void => {
                if (finished) return;
                if (this.countInProgress() > 0) return; // still draining in-flight work
                if (!signal.aborted && candidates().length > 0) return; // more to launch
                settle();
            };

            const pump = (): void => {
                if (finished) return;
                if (!signal.aborted) {
                    const free = this.globalMaxConcurrent - this.countInProgress();
                    if (free > 0) {
                        const toStart = candidates().slice(0, free);
                        for (const task of toStart) {
                            task.running = true;
                            task.runnedAt = new Date();
                            task.attempt += 1;

                            const promise = this.processTask(task, signal).finally(() => {
                                // Slot freed — fill it, then re-check for batch completion.
                                pump();
                                maybeFinish();
                            });
                            // processTask already routes errors to task status; guard the
                            // outer chain so an unexpected throw can't become unhandled.
                            void promise.catch(() => {});
                        }
                        if (toStart.length > 0) this.notifySubscribers();
                    }
                }
                maybeFinish();
            };

            pump();
        });
    }

    public stopProcessing(): void {
        this.stopping = true;
        this.abortController?.abort();
        this.notifySubscribers();
    }

    private clearQueuedStatus(): void {
        for (const task of this.tasks) {
            if (!task.running && task.finishedAt === undefined) {
                const s = task.getStatus().get();
                if (s.type === StatusType.Pending) {
                    task.getStatus().clear();
                }
            }
        }
    }

    public isProcessing(): boolean {
        return this.processing;
    }

    public isStopping(): boolean {
        return this.stopping;
    }

    public subscribe(callback: OrchestratorSubscriber): () => void {
        this.subscribers.add(callback);
        callback(this); // Send current state immediately

        return () => {
            this.subscribers.delete(callback);
        };
    }

    private notifySubscribers(): void {
        // Coalesced to one flush per frame (see notificationScheduler); prevents the
        // orchestrator from stacking commits when many tasks transition at once.
        notificationScheduler.schedule(this.emitToSubscribers);
    }

    private emitToSubscribers = (): void => {
        this.subscribers.forEach((callback) => callback(this));
    };
}
