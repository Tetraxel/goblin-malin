import { Logger } from "./logger/logger";
import { ServiceBase } from "./service-base";
import { ServiceScope } from "./service-scope";
import { Task } from "./task/task";

export type ServiceFactory<TTask extends Task<any>, TService extends ServiceBase> = (task: TTask, logger: Logger) => TService;

// Central registry for services, allowing dynamic registration and scoped instantiation
// For example, user can enable/disable certain services
export class ServiceRegistry<TTask extends Task<any>, TService extends ServiceBase> {
    private factories = new Map<string, ServiceFactory<TTask, TService>>();

    public getFactories(): Map<string, ServiceFactory<TTask, TService>> {
        return this.factories;
    }

    public register(name: string, factory: ServiceFactory<TTask, TService>): this {
        this.factories.set(name, factory);
        return this; // fluent chaining
    }

    public unregister(name: string): this {
        this.factories.delete(name);
        return this;
    }

    // Each service will call createScope to get a scope specific to the task, ensuring services are instantiated once per task but with different loggers
    public createScope(task: TTask, logger: Logger): ServiceScope<TTask, TService> {
        return new ServiceScope<TTask, TService>(this.factories, task, logger);
    }
}
