import { type StatusAttributes, TaskStatus } from "./task-status";
import { TaskPrompt, type UserPrompt } from "./task-prompt";
import { type Logger } from "../logger/logger";
import { notificationScheduler } from "../notificationScheduler";

export interface DownloadTaskData {
    id: string;
    url: string;
    artist?: string;
    track?: string;
}

export type TaskSubscriber<TTAttributes> = (task: Task<TTAttributes>) => void;
export type TaskSubscribers<TTAttributes> = Set<TaskSubscriber<TTAttributes>>;
export type TaskAttributes = Record<string, unknown>;
export type TaskSnapshot<TTAttributes = TaskAttributes> = {
    id: string;
    initialInput: string | undefined;
    attributes: TTAttributes | undefined;
    status: StatusAttributes;
    prompt: UserPrompt | null;
};

/**
 * "Some task changed", once per frame. Code that only needs to know that something changed somewhere (saving the
 * session) listens here instead of subscribing to every task: a subscription per task is re-created whenever the
 * task list changes and replays its callback immediately, which costs O(N²) with N tasks.
 */
const anyTaskListeners = new Set<() => void>();
/** Stable reference, so the scheduler dedupes it: any number of tasks changing in a frame emits once. */
const emitAnyTaskChanged = (): void => {
    anyTaskListeners.forEach((listener) => listener());
};

export class Task<TTaskAttributes = TaskAttributes> {
    public readonly id: string;
    protected initialInput?: string;
    protected attributes?: TTaskAttributes;
    protected logger: Logger;
    protected status: TaskStatus;
    protected prompt: TaskPrompt;
    protected subscribers: TaskSubscribers<TTaskAttributes> = new Set();

    public enabled: boolean = true;
    public running: boolean = false;
    public runnedAt: Date | undefined;
    public finishedAt: Date | undefined;
    public attempt: number = 0;
    public success: boolean = false;

    // Snapshot cache — invalidated on every notifyTaskSubscribers call so React.memo
    // in cell components can bail out when the task data hasn't actually changed.
    private _snapshotCache: TaskSnapshot<TTaskAttributes> | null = null;

    constructor({
        id,
        initialInput,
        attributes,
        logger,
        initialStatus,
    }: {
        id: string;
        initialInput?: string;
        attributes?: TTaskAttributes;
        logger: Logger;
        initialStatus?: StatusAttributes;
    }) {
        this.id = id;
        this.initialInput = initialInput;
        this.attributes = attributes;
        this.logger = logger.createChild({
            task: this,
        });

        // Initialize status, restoring persisted status when provided (e.g. from session)
        this.status = new TaskStatus(initialStatus);
        this.prompt = new TaskPrompt(this.id, this.status, () => this.notifyTaskSubscribers());

        // Subscribe to status changes to notify task subscribers
        this.status.subscribe(() => {
            this.notifyTaskSubscribers();
        });
    }

    public get(): TaskSnapshot<TTaskAttributes> {
        if (this._snapshotCache) return this._snapshotCache;
        this._snapshotCache = {
            id: this.id,
            initialInput: this.initialInput,
            attributes: this.getAttributes(),
            status: this.status.get(),
            prompt: this.prompt.get(),
        };
        return this._snapshotCache;
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

    public getLogger(): Logger {
        return this.logger;
    }

    /**
     * Short, human-readable label identifying this task in log lines (e.g. a
     * track uri). Returns undefined by default; subclasses override. The full
     * string is returned here — the log panel truncates it to fit.
     */
    public getLogLabel(): string | undefined {
        return undefined;
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

    async start(_signal?: AbortSignal): Promise<void> {
        throw Error("Not implemented");
    }

    async stop(): Promise<void> {
        throw Error("Not implemented");
    }

    /**
     * Calls `listener` (at most once per frame) after any task changed: its attributes, its status or its prompt.
     * It does not say which task: read the task list when you need it. Unlike `subscribe` it does not replay
     * the current state.
     */
    public static subscribeToAny(listener: () => void): () => void {
        anyTaskListeners.add(listener);
        return () => {
            anyTaskListeners.delete(listener);
        };
    }

    /**
     * Subscribe to any changes in the task (including status changes). The callback is called once right away with
     * the current state, unless `immediate: false` (for a caller that already read it).
     */
    public subscribe(callback: TaskSubscriber<TTaskAttributes>, options: { immediate?: boolean } = {}): () => void {
        this.subscribers.add(callback);
        if (options.immediate !== false) callback(this); // Send current state immediately

        return () => {
            this.subscribers.delete(callback);
        };
    }

    protected notifyTaskSubscribers(): void {
        // Invalidate the snapshot synchronously so any code that reads `get()` before
        // the deferred flush still sees fresh data (only the render fan-out defers).
        this._snapshotCache = null;
        // Coalesce the subscriber fan-out to one flush per frame. `emitToSubscribers`
        // is a stable bound reference, so repeated changes within a frame dedupe to a
        // single notification — N parallel updates → O(1) commits/frame.
        notificationScheduler.schedule(this.emitToSubscribers);
        notificationScheduler.schedule(emitAnyTaskChanged);
    }

    private emitToSubscribers = (): void => {
        this.subscribers.forEach((callback) => callback(this));
    };
}
