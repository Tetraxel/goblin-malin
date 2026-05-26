import { globalLogger } from "#base/logger/logger";

// Symbol stamped on an error the first time a @SafeAction decorator logs it.
// Subsequent decorators up the call chain see the flag and skip re-logging.
const LOGGED = Symbol("safeAction.logged");

export function SafeAction(label?: string) {
    return function (target: object, propertyKey: string, descriptor: PropertyDescriptor): PropertyDescriptor {
        const originalMethod = descriptor.value as (...args: unknown[]) => Promise<unknown>;

        descriptor.value = async function (...args: unknown[]) {
            try {
                return await originalMethod.apply(this, args);
            } catch (error: unknown) {
                if (!(error as Record<symbol, unknown>)[LOGGED]) {
                    const name = label ?? propertyKey;
                    const cause = error instanceof Error ? error.message : String(error);
                    const stack = error instanceof Error ? error.stack : undefined;
                    globalLogger.error(`${name} — ${cause}`, stack ? { stack } : undefined);
                    if (typeof error === "object" && error !== null) {
                        (error as Record<symbol, unknown>)[LOGGED] = true;
                    }
                }
                throw error;
            }
        };

        return descriptor;
    };
}
