import { Logger } from "./logger/logger";
import { ServiceBase } from "./service-base";
import { ServiceScope } from "./service-scope";
import { Task } from "./task/task";
import { ProviderDisplay, providerDisplayRegistry } from "./providerDisplay";
import { ParsedUrl, urlParserRegistry } from "./urlParser";
import { ProviderSettingsSchema } from "./providerSettings";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ServiceFactory<TTask extends Task<any>, TService extends ServiceBase> = (
    task: TTask,
    logger: Logger
) => TService;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServiceConstructor<TTask extends Task<any>, TService extends ServiceBase> = {
    new (task: TTask, logger: Logger): TService;
    display?: ProviderDisplay;
    parseUrl?: (url: string) => ParsedUrl | null;
    defaultSettings?: ProviderSettingsSchema;
};

// Central registry for services, allowing dynamic registration and scoped instantiation
// For example, user can enable/disable certain services
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class ServiceRegistry<TTask extends Task<any> = Task, TService extends ServiceBase = ServiceBase> {
    private factories = new Map<string, ServiceFactory<TTask, TService>>();
    private constructors = new Map<string, ServiceConstructor<TTask, TService>>();

    public getFactories(): Map<string, ServiceFactory<TTask, TService>> {
        return this.factories;
    }

    public getEnabledFactories(isEnabled: (name: string) => boolean): Map<string, ServiceFactory<TTask, TService>> {
        return new Map([...this.factories].filter(([k]) => isEnabled(k)));
    }

    public getConstructor(name: string): ServiceConstructor<TTask, TService> | undefined {
        return this.constructors.get(name);
    }

    public register(
        name: string,
        ctorOrFactory: ServiceConstructor<TTask, TService> | ServiceFactory<TTask, TService>
    ): this {
        if (typeof ctorOrFactory === "function" && ctorOrFactory.prototype instanceof ServiceBase) {
            // Class constructor path: derive factory, store constructor, auto-register display
            const ctor = ctorOrFactory as ServiceConstructor<TTask, TService>;
            this.factories.set(name, (task, logger) => new ctor(task, logger));
            this.constructors.set(name, ctor);
            if (ctor.display) providerDisplayRegistry.register(name, ctor.display);
            if (ctor.parseUrl) urlParserRegistry.register(ctor.parseUrl);
        } else {
            // Plain factory function path (escape hatch for custom instantiation)
            this.factories.set(name, ctorOrFactory as ServiceFactory<TTask, TService>);
        }
        return this; // fluent chaining
    }

    public unregister(name: string): this {
        this.factories.delete(name);
        this.constructors.delete(name);
        return this;
    }

    // Each service will call createScope to get a scope specific to the task, ensuring services are instantiated once per task but with different loggers
    public createScope(
        task: TTask,
        logger: Logger,
        isEnabled?: (name: string) => boolean
    ): ServiceScope<TTask, TService> {
        return new ServiceScope<TTask, TService>(this.factories, task, logger, isEnabled);
    }
}
