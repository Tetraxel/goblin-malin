import { globalLogger, Logger } from "../logger/logger";
import { Task } from "../task/task";
import { StatusType } from "../task/task-status";
import { FlowBase } from "./flow-base";


// This interface represents the class itself, not the instance
export interface FlowClass {
    getInstance(logger: Logger, defaultEnabled: boolean, orchestrator: FlowOrchestrator): FlowBase
}


// New subscriber type for the orchestrator
type OrchestratorSubscriber = (orchestrator: FlowOrchestrator) => void;

export class FlowOrchestrator {
    private static instance: FlowOrchestrator;
    private globalMaxConcurrent: number = 3;
    private logger: Logger;
    private subscribers: Set<OrchestratorSubscriber> = new Set();
    private flows: Set<FlowBase> = new Set();
    private tasks: Task[] = [];
    private activeTasks: Task[] = []

    private constructor() {
        this.logger = globalLogger.createChild({ service: 'FlowOrchestrator' });
    }

    static getInstance(): FlowOrchestrator {
        if (!FlowOrchestrator.instance) {
            FlowOrchestrator.instance = new FlowOrchestrator();
        }
        return FlowOrchestrator.instance;
    }

    registerFlow(flowClass: FlowClass, defaultEnabled: boolean = false): void {
        const flow = flowClass.getInstance(this.logger, defaultEnabled, this)
        const id = flow.id;
        const displayName = flow.displayName;
        const author = flow.author;

        if (!id || !displayName || !author) {
            throw new Error(`Flow class must have unique id, displayName, and author`);
        }

        this.flows.add(flow);
        this.logger.info(`Registered flow: ${displayName} (${id})`);

        this.notifySubscribers();
    }

    getFlow(flowId: string): FlowBase | undefined {
        return Array.from(this.flows).find(flow => flow.id === flowId);
    }

    getAllFlows(): Array<FlowBase> {
        return Array.from(this.flows)
    }

    getEnabledFlows(): Array<FlowBase> {
        return this.getAllFlows().filter(flow => flow.enabled);
    }

    // ============ TASK QUEUE MANAGEMENT ============

    setGlobalMaxConcurrent(max: number): void {
        this.globalMaxConcurrent = max;
        this.notifySubscribers();
    }

    addTasks(tasks: Task[]): void {
        // check that none of the tasks are already in the queue
        for (const task of tasks) {
            const existingTask = this.tasks.find(existingTask => existingTask.getId() === task.getId());
            if (existingTask) {
                // this.logger.warn(`Task ${task.getId()} is already in the queue`);
                throw new Error(`Task ${task.getId()} is already in the queue`);
            }
        }

        this.tasks = this.tasks.concat(tasks)
        this.notifySubscribers();
    }

    public getTasks(): Task[] {
        return this.tasks
    }

    public getTasksCandidates(): Task[] {
        return this.tasks.filter((task) => !task.running && task.finishedAt == undefined)
    }

    public getTasksInProgress(): Task[] {
        return this.tasks.filter((task) => task.running)
    }

    public async processTasks(): Promise<void> {
        const promises: Promise<void>[] = [];
        this.logger.info(`Processing ${this.getTasksCandidates()} tasks`)

        while (this.getTasksCandidates().length > 0 || this.getTasksInProgress().length > 0) {
            // Start new tasks up to maxConcurrent
            while (
                this.getTasksCandidates().length > 0 &&
                this.getTasksInProgress().length < this.globalMaxConcurrent
            ) {
                const task = this.getTasksCandidates()[0];

                if (!task) break;

                task.running = true
                task.runnedAt = new Date()
                task.attempt += 1

                // Start processing without awaiting (parallel execution)
                const promise = task.start()
                    .then(() => {
                        task.success = true
                    })
                    .catch((error: Error) => {
                        task.getStatus().set({
                            type: StatusType.Error,
                            message: "Failed to process task",
                        });
                        this.logger.error(`Failed to process ${task.getId()} ${task.getInitialInput()}: ${error.message}`, { stack: error.stack });
                    })
                    .finally(() => {
                        task.running = false
                        task.finishedAt = new Date()
                    });

                promises.push(promise);
            }

            this.notifySubscribers();

            // Wait for at least one download to complete before continuing
            if (this.getTasksInProgress().length >= this.globalMaxConcurrent) {
                await Promise.race(promises);
            }

            this.notifySubscribers();

            // Small delay to prevent tight loop
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Wait for all remaining downloads to complete
        await Promise.all(promises);
        this.notifySubscribers();
    }

    public subscribe(callback: OrchestratorSubscriber): () => void {
        this.subscribers.add(callback);
        callback(this); // Send current state immediately

        return () => {
            this.subscribers.delete(callback);
        };
    }

    private notifySubscribers(): void {
        this.subscribers?.forEach(callback => callback(this));
    }
}