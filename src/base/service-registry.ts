import { type Logger } from "./logger/logger";
import { ServiceBase } from "./service-base";
import { ServiceScope } from "./service-scope";
import { platformRegistry } from "./platformRegistry";
import { type Task } from "./task/task";
import { type ProviderDisplay, providerDisplayRegistry } from "./providerDisplay";
import { type ParsedUrl, type CollectionExpansion, urlParserRegistry } from "./urlParser";
import { type ProviderConsent, type ProviderSettingsSchema } from "./providerSettings";
import { type ContextualActions } from "#types/actions";

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
    /** Optional: turn links in another notation (e.g. `spotify:track:<id>`) found in a text into URLs `parseUrl` reads. */
    findLinks?: (text: string) => string[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expandCollection?: (url: string, logger: Logger, task: Task<any>) => Promise<CollectionExpansion>;
    defaultSettings?: ProviderSettingsSchema;
    // Must be explicitly allowed by the user (once) before the service is ever used.
    consent?: ProviderConsent;
    // Slow/expensive last resort: only run when the regular services left a gap.
    lastResort?: boolean;
    // Other platform keys this service also handles (e.g. YouTube Music links are YouTube videos).
    platformAliases?: readonly string[];
    // Canonical URL of one of this service's tracks, given its platform id.
    trackUrl?: (id: string) => string;
    // The address that opens one of this service's links (as `parseUrl` read it) in its desktop app, when it has one
    // (`spotify:track:<id>`). Read through `platformRegistry.openUri()`.
    openUri?: (parsed: ParsedUrl) => string | undefined;
    // Extra actions for the service's column in the task list (read generically, e.g. "Review match…"), given the
    // selected task. Called whenever the action bar is built: keep it cheap and free of side effects.
    columnActions?: (task: TTask) => ContextualActions[];
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

    public getAllConstructors(): Map<string, ServiceConstructor<TTask, TService>> {
        return new Map(this.constructors);
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
            if (ctor.platformAliases) platformRegistry.registerAliases(name, ctor.platformAliases);
            if (ctor.trackUrl) platformRegistry.registerTrackUrl(name, ctor.trackUrl);
            if (ctor.openUri) platformRegistry.registerOpenUri(name, ctor.openUri);
            if (ctor.parseUrl) urlParserRegistry.register(ctor.parseUrl);
            if (ctor.findLinks) urlParserRegistry.registerNormalizer(ctor.findLinks);
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
