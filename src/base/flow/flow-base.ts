import { Logger } from "../logger/logger";
import { ColumnDefinition } from "../../components/TaskListPanel";
import { ToolbarButtonHook } from "../../components/Toolbar";
import { FlowOrchestrator } from "./flow-orchestrator";
import { Task } from "../task/task";

export type FlowSubscriber<TTaskAttributes> = (flow: FlowBase<TTaskAttributes>) => void;
export type FlowSubscribers<TTaskAttributes> = Set<FlowSubscriber<TTaskAttributes>>;

export class FlowBase<TaskAttributes = any> {
    public readonly id: string = "";
    public readonly displayName: string = "";
    public readonly author: string = "";

    public enabled: boolean = true;
    protected logger: Logger;
    protected orchestrator: FlowOrchestrator;
    protected maxConcurrentTasks: number = 1;
    protected displayMode: string = "default";
    protected subscribers: FlowSubscribers<TaskAttributes> = new Set();

    protected constructor(logger: Logger, defaultEnabled: boolean, orchestrator: FlowOrchestrator) {
        this.logger = logger;
        this.enabled = defaultEnabled;
        this.orchestrator = orchestrator;
    }

    // Default implementations
    public async initialize(): Promise<void> {
        throw Error('Not implemented')
    }

    public async importTasks(): Promise<void> {
        throw Error('Not implemented')
    }

    public async restartTask(task: Task<TaskAttributes>): Promise<void> {
        throw Error('Not implemented')
    }

    public async runAll(): Promise<void> {
        throw Error('Not implemented')
    }

    public async stopAll(): Promise<void> {
        throw Error('Not implemented')
    }

    public getMaxConcurrentTasks(): number {
        return this.maxConcurrentTasks;
    }

    public getDisplayMode(): string {
        return this.displayMode;
    }

    public switchMode(input: string): void {
        throw Error('Not implemented')
    }

    // UI methods
    public getToolbarButtons(): ToolbarButtonHook[] {
        throw Error('Not implemented')
    }
    public getColumns(): ColumnDefinition<TaskAttributes>[] {
        throw Error('Not implemented')
    }

    // Subscribe to any changes in the task (including status changes)
    public subscribe(callback: FlowSubscriber<TaskAttributes>): () => void {
        this.subscribers.add(callback);
        callback(this); // Send current state immediately

        return () => {
            this.subscribers.delete(callback);
        };
    }

    protected notifyTaskSubscribers(): void {
        this.subscribers?.forEach(callback => callback(this));
    }
}
