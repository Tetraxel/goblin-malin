import { StatusAttributes, TaskStatus } from './task-status';
import { TaskPrompt, UserPrompt } from './task-prompt';

export interface DownloadTaskData {
    id: string;
    url: string;
    artist?: string;
    track?: string;
}

export type TaskSubscriber<TAttributes> = (task: Task<TAttributes>) => void;
export type TaskSubscribers<TAttributes> = Set<TaskSubscriber<TAttributes>>;
export type TaskAttributes = Record<string, any>
export type TaskSnapshot<TAttributes = TaskAttributes> = {
    id: string;
    initialInput: string | undefined;
    attributes: TAttributes | undefined;
    status: StatusAttributes;
    prompt: UserPrompt | null;
}

export class Task<TAttributes = TaskAttributes> {
    protected id: string;
    protected initialInput?: string;
    protected attributes?: TAttributes;
    protected status: TaskStatus;
    protected prompt: TaskPrompt;
    protected subscribers: TaskSubscribers<TAttributes> = new Set();

    constructor({ id, initialInput, attributes }: { id: string; initialInput?: string; attributes?: TAttributes }) {
        this.id = id;
        this.initialInput = initialInput;
        this.attributes = attributes;

        // Initialize status
        this.status = new TaskStatus();
        this.prompt = new TaskPrompt(this.id, this.status, this.notifyTaskSubscribers);

        // Subscribe to status changes to notify task subscribers
        this.status.subscribe(() => {
            this.notifyTaskSubscribers();
        });
    }

    public get(): TaskSnapshot<TAttributes> {
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

    public setInitialInput(initialInput: string): void {
        this.initialInput = initialInput;
        this.notifyTaskSubscribers();
    }

    public setAttributes(track: TAttributes): void {
        this.attributes = track;
        this.notifyTaskSubscribers();
    }

    // Subscribe to any changes in the task (including status changes)
    public subscribe(callback: TaskSubscriber<TAttributes>): () => void {
        this.subscribers.add(callback);
        callback(this); // Send current state immediately

        return () => {
            this.subscribers.delete(callback);
        };
    }

    private notifyTaskSubscribers(): void {
        this.subscribers?.forEach(callback => callback(this));
    }
}
