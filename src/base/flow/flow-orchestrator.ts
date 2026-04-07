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
    public readonly id = "flow-orchestrator";
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

    public async processTask(task: Task): Promise<void> {
        // Clean attributes in case the task is restarted
        task.setAttributes({})

        return task.start()
            .then(() => {
                task.success = true
            })
            .catch((error: Error) => {
                task.getStatus().set({
                    type: StatusType.Error,
                    message: "Failed to process task",
                });
                task.getLogger().error(`Failed to process ${task.getId()} ${task.getInitialInput()}: ${error.message}`, { stack: error.stack });
            })
            .finally(() => {
                task.running = false
                task.finishedAt = new Date()
            });
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

                // Start processing without awaiting (for parallel execution)
                const promise = this.processTask(task)
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

    // ============ TASK PROCESSING ============

    // private async processAllFlows(): Promise<void> {
    //     const allPromises: Promise<void>[] = [];

    //     while (this.hasTasksInAnyQueue() || this.hasActiveTasksInAnyFlow()) {
    //         // Process each enabled flow
    //         for (const [flowId, queue] of this.queuesByFlow.entries()) {
    //             // Skip if flow is disabled
    //             if (!this.enabledFlows.has(flowId)) {
    //                 continue;
    //             }

    //             const flowClass = this.registeredFlows.get(flowId);
    //             if (!flowClass) continue;

    //             const maxConcurrent = this.getMaxConcurrentForFlow(flowId);
    //             const activeTasks = this.activeTasksByFlow.get(flowId)!;

    //             while (queue.length > 0 && activeTasks.size < maxConcurrent) {
    //                 if (this.getTotalActiveTasks() >= this.globalMaxConcurrent) {
    //                     break;
    //                 }

    //                 const task = queue.shift()!;
    //                 activeTasks.add(task.getId());

    //                 const flowInstance = new (flowClass as any)(this.logger, task);

    //                 const promise = this.processTask(flowInstance, task, flowId);
    //                 allPromises.push(promise);
    //             }
    //         }

    //         if (this.getTotalActiveTasks() >= this.globalMaxConcurrent) {
    //             await Promise.race(allPromises.filter(p => p));
    //         }

    //         await new Promise(resolve => setTimeout(resolve, 100));
    //     }

    //     await Promise.all(allPromises);
    // }

    // private async processTask(
    //     flowInstance: FlowBase,
    //     task: Task,
    //     flowId: string
    // ): Promise<void> {
    //     try {
    //         await task.start();
    //     } catch (error: any) {
    //         task.getStatus().set({
    //             type: StatusType.Error,
    //             message: "Failed to process task"
    //         });
    //         this.logger.error(
    //             `Failed to process ${ task.getId() }: ${ error.message }`,
    //             { stack: error.stack }
    //         );
    //     } finally {
    //         this.activeTasksByFlow.get(flowId)?.delete(task.getId());
    //     }
    // }

    // ============ HELPER METHODS ============

    // private getMaxConcurrentForFlow(flowId: string): number {
    //     // const flowClass = this.registeredFlows.get(flowId);
    //     // if (!flowClass) return 1;

    //     // return instance.getMaxConcurrentTasks();
    // }

    // private getTotalActiveTasks(): number {
    //     let total = 0;
    //     for (const tasks of this.activeTasksByFlow.values()) {
    //         total += tasks.size;
    //     }
    //     return total;
    // }

    // private hasTasksInAnyQueue(): boolean {
    //     for (const queue of this.queuesByFlow.values()) {
    //         if (queue.length > 0) return true;
    //     }
    //     return false;
    // }

    // private hasActiveTasksInAnyFlow(): boolean {
    //     for (const tasks of this.activeTasksByFlow.values()) {
    //         if (tasks.size > 0) return true;
    //     }
    //     return false;
    // }

    // ============ CONTROL METHODS ============


    // getQueueStatus(): Map<string, { queued: number; active: number }> {
    //     const status = new Map();
    //     for (const [flowId, queue] of this.queuesByFlow.entries()) {
    //         status.set(flowId, {
    //             queued: queue.length,
    //             active: this.activeTasksByFlow.get(flowId)?.size || 0
    //         });
    //     }
    //     return status;
    // }

}


// export class FlowOrchestrator {
//     private static instance: FlowOrchestrator;
//     private globalMaxConcurrent: number = 3;
//     private flowRegistry: FlowRegistry;
//     private logger: Logger;

//     // Track active tasks per flow
//     private activeTasksByFlow: Map<string, Set<string>> = new Map();
//     private queuesByFlow: Map<string, Task[]> = new Map();
//     private processing: boolean = false;

//     private constructor() {
//         this.logger = globalLogger.createChild({ service: 'FlowOrchestrator' });
//         this.flowRegistry = FlowRegistry.getInstance();
//     }

//     static getInstance(): FlowOrchestrator {
//         if (!FlowOrchestrator.instance) {
//             FlowOrchestrator.instance = new FlowOrchestrator();
//         }
//         return FlowOrchestrator.instance;
//     }

//     setGlobalMaxConcurrent(max: number): void {
//         this.globalMaxConcurrent = max;
//     }

//     addToQueue(tasks: Task[]): void {
//         // Group tasks by flow
//         for (const task of tasks) {
//             const flowId = task.getFlowId();
//             if (!this.queuesByFlow.has(flowId)) {
//                 this.queuesByFlow.set(flowId, []);
//                 this.activeTasksByFlow.set(flowId, new Set());
//             }
//             this.queuesByFlow.get(flowId)!.push(task);
//         }
//     }

//     async startProcessing(): Promise<void> {
//         if (this.processing) {
//             this.logger.warn('Processing already in progress');
//             return;
//         }

//         this.processing = true;
//         await this.processAllFlows();
//         this.processing = false;
//     }

//     private async processAllFlows(): Promise<void> {
//         const allPromises: Promise<void>[] = [];

//         while (this.hasTasksInAnyQueue() || this.hasActiveTasksInAnyFlow()) {
//             // Process each flow
//             for (const [flowId, queue] of this.queuesByFlow.entries()) {
//                 const flowDef = this.flowRegistry.get(flowId);
//                 if (!flowDef) continue;

//                 const maxConcurrent = this.getMaxConcurrentForFlow(flowId);
//                 const activeTasks = this.activeTasksByFlow.get(flowId)!;

//                 // Start new tasks up to the limit
//                 while (queue.length > 0 && activeTasks.size < maxConcurrent) {
//                     // Check global limit
//                     if (this.getTotalActiveTasks() >= this.globalMaxConcurrent) {
//                         break;
//                     }

//                     const task = queue.shift()!;
//                     activeTasks.add(task.getId());

//                     const flowInstance = this.flowRegistry.createFlowInstance(
//                         flowId,
//                         this.logger,
//                         task
//                     );

//                     if (!flowInstance) {
//                         this.logger.error(`Failed to create flow instance for ${ flowId }`);
//                         continue;
//                     }

//                     const promise = this.processTask(flowInstance, task, flowId);
//                     allPromises.push(promise);
//                 }
//             }

//             // Wait for at least one task to complete if at capacity
//             if (this.getTotalActiveTasks() >= this.globalMaxConcurrent) {
//                 await Promise.race(allPromises.filter(p => p));
//             }

//             await new Promise(resolve => setTimeout(resolve, 100));
//         }

//         await Promise.all(allPromises);
//     }

//     private async processTask(
//         flowInstance: FlowBase,
//         task: Task,
//         flowId: string
//     ): Promise<void> {
//         try {
//             await flowInstance.start();
//         } catch (error: any) {
//             task.getStatus().set({
//                 type: StatusType.Error,
//                 message: "Failed to process task"
//             });
//             this.logger.error(
//                 `Failed to process ${ task.getId() }: ${ error.message } `,
//                 { stack: error.stack }
//             );
//         } finally {
//             this.activeTasksByFlow.get(flowId)?.delete(task.getId());
//         }
//     }

//     private getMaxConcurrentForFlow(flowId: string): number {
//         const flowDef = this.flowRegistry.get(flowId);
//         if (!flowDef) return 1;

//         // Create a temporary instance to get max concurrent
//         // Or store this in FlowDefinition
//         const tempTask = new Task({
//             id: 'temp',
//             flowId,
//             initialInput: ''
//         });
//         const instance = new flowDef.classReference(this.logger, tempTask);
//         return instance.getMaxConcurrentTasks();
//     }

//     private getTotalActiveTasks(): number {
//         let total = 0;
//         for (const tasks of this.activeTasksByFlow.values()) {
//             total += tasks.size;
//         }
//         return total;
//     }

//     private hasTasksInAnyQueue(): boolean {
//         for (const queue of this.queuesByFlow.values()) {
//             if (queue.length > 0) return true;
//         }
//         return false;
//     }

//     private hasActiveTasksInAnyFlow(): boolean {
//         for (const tasks of this.activeTasksByFlow.values()) {
//             if (tasks.size > 0) return true;
//         }
//         return false;
//     }

//     async stopFlow(flowId: string): Promise<void> {
//         const queue = this.queuesByFlow.get(flowId);
//         if (queue) {
//             queue.length = 0; // Clear queue
//         }
//         // Active tasks will complete naturally
//     }

//     stop(): void {
//         this.queuesByFlow.clear();
//         this.processing = false;
//     }
// }
