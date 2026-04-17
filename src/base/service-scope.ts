import { Task } from "./task/task";
import { Logger } from "./logger/logger";
import { ServiceFactory } from "./service-registry";
import { ServiceBase } from "./service-base";

// A scope ensures each service is instantiated only once per task but with different logger for each task
export class ServiceScope<TTask extends Task<any>, TService extends ServiceBase> {
    private instances = new Map<string, any>();

    constructor(
        private factories: Map<string, ServiceFactory<TTask, TService>>,
        private task: TTask,
        private logger: Logger
    ) { }

    get<T extends TService>(name: string): T {
        if (!this.instances.has(name)) {
            const factory = this.factories.get(name);
            if (!factory) throw new Error(`Service "${name}" is not registered`);
            this.instances.set(name, factory(this.task, this.logger));
        }
        return this.instances.get(name) as T;
    }

    getAllServices(): TService[] {
        const services: TService[] = [];
        for (const name of this.factories.keys()) {
            services.push(this.get(name));
        }
        return services;
    }
}
