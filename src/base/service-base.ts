import { EventEmitter } from 'events';
import { Logger } from './logger/logger';
import { Task } from './task/task';
import { Env } from './env';
import { StatusType, TaskStatus } from './task/task-status';

export abstract class ServiceBase extends EventEmitter {
    protected serviceName: string;
    protected task: Task;
    protected logger: Logger;
    protected env: Env;
    protected status: TaskStatus;

    private static _executionLocks: Map<string, Promise<any>> = new Map();

    constructor(serviceName: string, task: Task, logger: Logger) {
        super();
        this.serviceName = serviceName;
        this.task = task;
        this.logger = logger.createChild({
            service: this.serviceName,
            task: this.task,
        });
        this.env = new Env(task, this.logger)
        this.status = this.task.getStatus();
    }

    /**
     * Executes a function exclusively based on a key.
     * If another instance is already running this key, it waits for the result 
     * of that specific run instead of starting a new one.
     */
    protected async runExclusive<T>(actionKey: string, operation: () => Promise<T>): Promise<T> {
        const key = `${this.serviceName}.${actionKey}`
        // Check if this operation is already running globally
        if (ServiceBase._executionLocks.has(key)) {

            this.status.set({
                type: StatusType.Locked,
                message: `Waiting operation: ${key}`,
                timeTracking: false,
            });
            return ServiceBase._executionLocks.get(key) as Promise<T>;
        }

        // Initialize the operation
        const promise = operation();

        // Store the promise in the static map (The Lock)
        ServiceBase._executionLocks.set(key, promise);

        try {
            // Wait for the operation to complete
            return await promise;
        } catch (error) {
            this.logger.error(`runExclusive ${error}`)
        }
        finally {
            // Clean up: Remove the lock so future calls can run if needed.
            ServiceBase._executionLocks.delete(key);
        }
    }
}
