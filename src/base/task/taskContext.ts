import { AsyncLocalStorage } from "async_hooks";
import type { Task } from "./task";

// Ambient "current task" used to attribute logs emitted by shared code
// (cache decorator, @SafeAction, url parsing, …) that doesn't hold a task-scoped
// logger. Mirrors the AsyncLocalStorage pattern in #utils/cache.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const taskStorage = new AsyncLocalStorage<Task<any>>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function runInTaskContext<T>(task: Task<any>, fn: () => T): T {
    return taskStorage.run(task, fn);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getCurrentTask(): Task<any> | undefined {
    return taskStorage.getStore();
}

/**
 * Method decorator that runs the wrapped method inside its task's context, so
 * every log emitted during the (sync or async) call — including from shared
 * helpers — is attributed to `this` task. Apply it as the OUTERMOST decorator
 * (above e.g. @SafeAction) so the context is established before inner wrappers run.
 */
export function TaskScoped() {
    return function (_target: object, _propertyKey: string, descriptor: PropertyDescriptor): PropertyDescriptor {
        const originalMethod = descriptor.value;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        descriptor.value = function (this: Task<any>, ...args: unknown[]) {
            return runInTaskContext(this, () => originalMethod.apply(this, args));
        };
        return descriptor;
    };
}
