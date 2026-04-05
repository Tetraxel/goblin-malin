import { Logger } from "../logger/logger";
import { ColumnDefinition } from "../../components/TaskListPanel";
import { ToolbarButtonHook } from "../../components/Toolbar";
import { FlowOrchestrator } from "./flow-orchestrator";
import { Task } from "../task/task";


export class FlowBase<TAttributes = any> {
    public readonly id: string = "";
    public readonly displayName: string = "";
    public readonly author: string = "";

    public enabled: boolean = true;
    protected logger: Logger;
    protected orchestrator: FlowOrchestrator;
    protected maxConcurrentTasks: number = 1;

    protected constructor(logger: Logger, defaultEnabled: boolean, orchestrator: FlowOrchestrator) {
        this.logger = logger;
        this.enabled = defaultEnabled;
        this.orchestrator = orchestrator;
    }

    // Default implementations
    async initialize(): Promise<void> {
        throw Error('Not implemented')
    }

    async importTasks(): Promise<void> {
        throw Error('Not implemented')
    }

    async restartTask(task: Task<TAttributes>): Promise<void> {
        throw Error('Not implemented')
    }

    async runAll(): Promise<void> {
        throw Error('Not implemented')
    }

    async stopAll(): Promise<void> {
        throw Error('Not implemented')
    }

    getMaxConcurrentTasks(): number {
        return this.maxConcurrentTasks;
    }

    // UI methods
    getToolbarButtons(): ToolbarButtonHook[] {
        throw Error('Not implemented')
    }
    getColumns(): ColumnDefinition<TAttributes>[] {
        throw Error('Not implemented')
    }
}
