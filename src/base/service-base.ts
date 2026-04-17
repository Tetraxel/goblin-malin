import { EventEmitter } from 'events';
import { Logger } from './logger/logger';
import { Task } from './task/task';
import { Env } from './env';
import { StatusType, TaskStatus } from './task/task-status';

export abstract class ServiceBase extends EventEmitter {
    public id: string;
    protected task: Task;
    protected logger: Logger;
    protected env: Env;
    protected status: TaskStatus;

    private static _executionLocks: Map<string, Promise<any>> = new Map();

    constructor(id: string, task: Task<any>, logger: Logger) {
        super();
        this.id = id;
        this.task = task;
        this.logger = logger.createChild({
            service: this.id,
            task: this.task,
        });
        this.env = new Env(task, this.logger)
        this.status = this.task.getStatus();
    }

    protected async runExclusive<T>(actionKey: string, operation: () => Promise<T>): Promise<T> {
        const key = `${this.id}.${actionKey}`;

        // Check if this operation is already running
        const existingPromise = ServiceBase._executionLocks.get(key);
        if (existingPromise) {
            this.status.set({
                type: StatusType.Locked,
                message: `Waiting operation: ${key}`,
                timeTracking: false,
            });
            // If there is already a promise with same key, just await it
            this.logger.info(`Awaiting for parallel promise ${key}`);
            const result = await existingPromise as T;
            this.logger.info(`Returning result coming from the parallel promise: ${result}`);
            return result;
        }

        // Create and store the promise IMMEDIATELY (atomic-like operation)
        const promise = (async () => {
            try {
                const result = await operation();
                this.logger.info(`Returning result coming from the promise: ${result}`);
                return result;
            } catch (error) {
                this.logger.error(`runExclusive ${error}`);
                throw error;
            } finally {
                // Clean up the lock after completion
                ServiceBase._executionLocks.delete(key);
            }
        })();

        ServiceBase._executionLocks.set(key, promise);

        return promise;
    }

    // /**
    //  * Executes a function exclusively based on a key.
    //  * If another instance is already running this key, it waits for the result 
    //  * of that specific run instead of starting a new one.
    //  */
    // protected async runExclusive<T>(actionKey: string, operation: () => Promise<T>): Promise<T> {
    //     const key = `${this.serviceName}.${actionKey}`
    //     // Check if this operation is already running globally
    //     if (ServiceBase._executionLocks.has(key)) {

    //         this.status.set({
    //             type: StatusType.Locked,
    //             message: `Waiting operation: ${key}`,
    //             timeTracking: false,
    //         });

    //         // Assign the same promise to return the right result 
    //         this.logger.info(`Awaiting for parallel promise ${key}`)
    //         const result = await ServiceBase._executionLocks.get(key) as Promise<T>;
    //         this.logger.info(`Returning result coming from the parallel promise: ${result}`)
    //         return result
    //     }

    //     // Initialize the operation
    //     const promise = operation();

    //     // Store the promise in the static map (The Lock)
    //     ServiceBase._executionLocks.set(key, promise);

    //     try {
    //         // Wait for the operation to complete
    //         const result = await promise;
    //         // Clean up: Remove the lock so future calls can run if needed.
    //         ServiceBase._executionLocks.delete(key);
    //         this.logger.info(`Returning result coming from the promise: ${result}`)
    //         return result
    //     } catch (error) {
    //         // Clean up: Remove the lock so future calls can run if needed.
    //         ServiceBase._executionLocks.delete(key);
    //         this.logger.error(`runExclusive ${error}`)
    //         throw error
    //     }
    // }
}
