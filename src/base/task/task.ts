import { StatusAttributes, TaskStatus } from './task-status';
import { TaskPrompt, UserPrompt } from './task-prompt';
import { Logger } from '../logger/logger';

export interface DownloadTaskData {
    id: string;
    url: string;
    artist?: string;
    track?: string;
}

export type TaskSubscriber<TTAttributes> = (task: Task<TTAttributes>) => void;
export type TaskSubscribers<TTAttributes> = Set<TaskSubscriber<TTAttributes>>;
export type TaskAttributes = Record<string, any>
export type TaskSnapshot<TTAttributes = TaskAttributes> = {
    id: string;
    initialInput: string | undefined;
    attributes: TTAttributes | undefined;
    status: StatusAttributes;
    prompt: UserPrompt | null;
}

export class Task<TTaskAttributes = TaskAttributes> {
    public readonly id: string;
    protected flowId: string;
    protected initialInput?: string;
    protected attributes?: TTaskAttributes;
    protected logger: Logger;
    protected status: TaskStatus;
    protected prompt: TaskPrompt;
    protected subscribers: TaskSubscribers<TTaskAttributes> = new Set();

    public enabled: boolean = true
    public running: boolean = false
    public runnedAt: Date | undefined
    public finishedAt: Date | undefined
    public attempt: number = 0
    public success: boolean = false

    constructor({ id, initialInput, attributes, flowId, logger }: {
        id: string; initialInput?: string; attributes?: TTaskAttributes, flowId: string, logger: Logger
    }) {
        this.id = id;
        this.flowId = flowId
        this.initialInput = initialInput;
        this.attributes = attributes;
        this.logger = logger.createChild({
            task: this,
        });

        // Initialize status
        this.status = new TaskStatus();
        this.prompt = new TaskPrompt(this.id, this.status, () => this.notifyTaskSubscribers());

        // Subscribe to status changes to notify task subscribers
        this.status.subscribe(() => {
            this.notifyTaskSubscribers();
        });
    }

    public get(): TaskSnapshot<TTaskAttributes> {
        return {
            id: this.id,
            initialInput: this.initialInput,
            attributes: this.getAttributes(),
            status: this.status.get(),
            prompt: this.prompt.get(),
        };
    }

    public getId(): string {
        return this.id;
    }

    public getFlowId(): string {
        return this.flowId;
    }

    public getInitialInput() {
        return this.initialInput;
    }

    public getAttributes() {
        return this.attributes;
    }

    public getStatus(): TaskStatus {
        return this.status;
    }

    public getPrompt(): TaskPrompt {
        return this.prompt;
    }

    public getLogger(): Logger {
        return this.logger;
    }

    public setInitialInput(initialInput: string): void {
        this.initialInput = initialInput;
        this.notifyTaskSubscribers();
    }

    public setAttributes(attributes: TTaskAttributes): void {
        this.attributes = attributes;
        this.notifyTaskSubscribers();
    }

    public updateAttributes(attributes: Partial<TTaskAttributes>): void {
        this.setAttributes({ ...this.attributes, ...attributes } as TTaskAttributes);
    }

    async start(): Promise<void> {
        throw Error('Not implemented')
    }

    async stop(): Promise<void> {
        throw Error('Not implemented')
    }

    // Subscribe to any changes in the task (including status changes)
    public subscribe(callback: TaskSubscriber<TTaskAttributes>): () => void {
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
