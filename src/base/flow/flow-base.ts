import { Logger } from "../logger/logger";
import { ColumnDefinition } from "../../components/TaskListPanel/TaskListPanel";
import { ContextualActionBar } from "../../types/actions";
import { ToolbarButtonHook } from "../../components/Toolbar/Toolbar";
import { FlowOrchestrator } from "./flow-orchestrator";
import { Task } from "../task/task";
import type { SettingsItem } from "../../settings/buildSettingsItems";

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

    public createTasksFromUrls(_urls: string[], _opts: Record<string, unknown>): Task<TaskAttributes>[] {
        throw Error('Not implemented')
    }

    public async importTasks(tasks: Task<TaskAttributes>[]): Promise<void> {
        const existingIds = new Set(this.orchestrator.getTasks().map(t => t.getId()));
        const seen = new Set<string>();
        const newTasks: Task<TaskAttributes>[] = [];
        let skippedCount = 0;

        for (const task of tasks) {
            const id = task.getId();
            if (existingIds.has(id) || seen.has(id)) { skippedCount++; continue; }
            seen.add(id);
            newTasks.push(task);
        }

        if (skippedCount > 0) this.logger.info(`Skipped ${skippedCount} task(s) already in queue`);
        if (newTasks.length > 0) {
            this.orchestrator.addTasks(newTasks);
            this.logger.info(`Imported ${newTasks.length} new task(s)`);
        }
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
    public getContextualActionBar(task: Task<TaskAttributes>, attributes: object): ContextualActionBar {
        throw Error('Not implemented')
    }
    public getColumns(): ColumnDefinition<TaskAttributes>[] {
        throw Error('Not implemented')
    }

    // Optional settings interface — flows that support settings implement these
    public getFlowSettings?(): Record<string, unknown>;
    public buildFlowSettingsItems?(
        flowSettings: Record<string, unknown>,
        onChange: (patch: Record<string, unknown>) => void,
    ): SettingsItem[];
    public saveFlowSettings?(settings: Record<string, unknown>): void;

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
