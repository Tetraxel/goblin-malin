/**
 * A typed event bus for things that happened ("a track was saved"), read by code that is not part of the pipeline
 * (extensions, P34). Generic infrastructure: the event names and payloads are declared by the flow that emits them.
 *
 * The rules every handler gets, whoever registered it:
 *  - it runs **after** the fact, asynchronously: `emit` never waits for it and never fails because of it;
 *  - it has a time limit (30 s unless it asked for more, at most 10 minutes) and is given a signal that aborts then;
 *  - a handler error is reported (to the reporter the app installs), never rethrown;
 *  - handlers of one owner for one key (a track's id) run one after the other, in order: two `track.saved` handlers of
 *    the same extension never overlap for the same track.
 *
 * A handler that runs past its limit is aborted (its `signal`) and given a short grace to end before the next handler of
 * its chain starts, so two handlers of one owner overlap only when one ignores its signal for longer than that.
 *
 * Payloads are built only when someone listens (pass a function), so an event nobody listens to costs nothing.
 */

export const DEFAULT_HANDLER_TIMEOUT_MS = 30_000;
export const MAX_HANDLER_TIMEOUT_MS = 10 * 60_000;
/** How long a handler that ran out of time is waited for (after its signal aborted) before the next one starts. */
export const DEFAULT_ABORT_GRACE_MS = 2_000;

export type EventHandlerContext = {
    /** Aborted when the handler's time is up (or the app is closing). */
    signal: AbortSignal;
    /** The event's name. */
    event: string;
};

export type EventHandler<T> = (payload: T, ctx: EventHandlerContext) => void | Promise<void>;

export type EventHandlerOptions = {
    /** Who registered it (an extension's name): its handlers are ordered per key, and its errors are named after it. */
    owner?: string;
    /** How long it may run, in ms (default 30 s, at most 10 minutes). */
    timeoutMs?: number;
};

type Entry = {
    handler: EventHandler<unknown>;
    owner: string;
    timeoutMs: number;
};

export type EventErrorReporter = (info: { owner: string; event: string; error: unknown; timedOut: boolean }) => void;

export class AppEventBus<TEvents extends { [K in keyof TEvents]: unknown }> {
    private handlers = new Map<keyof TEvents, Entry[]>();
    /** The tail of each (owner, key) chain, so handlers of one owner run in order for one key. */
    private chains = new Map<string, Promise<void>>();
    /** Every handler still running: `drain` waits for them. */
    private running = new Set<Promise<void>>();
    private reportError: EventErrorReporter = () => {};

    constructor(private readonly options: { abortGraceMs?: number } = {}) {}

    /** Where handler failures go (the app sends them to the log, named after their owner). */
    setErrorReporter(reporter: EventErrorReporter): void {
        this.reportError = reporter;
    }

    /** Adds a handler. Returns the function that removes it. */
    on<K extends keyof TEvents>(
        name: K,
        handler: EventHandler<TEvents[K]>,
        options: EventHandlerOptions = {}
    ): () => void {
        const timeoutMs = Math.min(
            Math.max(1, options.timeoutMs ?? DEFAULT_HANDLER_TIMEOUT_MS),
            MAX_HANDLER_TIMEOUT_MS
        );
        const entry: Entry = { handler: handler as EventHandler<unknown>, owner: options.owner ?? "app", timeoutMs };
        this.handlers.set(name, [...(this.handlers.get(name) ?? []), entry]);
        return () => {
            const left = (this.handlers.get(name) ?? []).filter((e) => e !== entry);
            if (left.length > 0) this.handlers.set(name, left);
            else this.handlers.delete(name);
        };
    }

    /** Whether anyone listens to this event (so its payload is worth building). */
    hasListeners(name: keyof TEvents): boolean {
        return (this.handlers.get(name)?.length ?? 0) > 0;
    }

    /**
     * Tells every handler, without waiting for any. `payload` may be a function: it is only called when someone
     * listens. `key` orders the handlers of one owner (a track's id); left out, they are ordered per event.
     */
    emit<K extends keyof TEvents>(name: K, payload: TEvents[K] | (() => TEvents[K]), key?: string): void {
        void this.dispatch(name, payload, key);
    }

    /**
     * Tells every handler and waits until they have all ended, or `maxMs` passed (what is left is aborted). Used for
     * `app.exit`, which must not keep the app from closing.
     */
    async emitAndWait<K extends keyof TEvents>(
        name: K,
        payload: TEvents[K] | (() => TEvents[K]),
        maxMs: number
    ): Promise<void> {
        const controller = new AbortController();
        const done = this.dispatch(name, payload, undefined, controller.signal);
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
            done,
            new Promise<void>((resolve) => {
                timer = setTimeout(() => {
                    controller.abort();
                    resolve();
                }, maxMs);
                timer.unref?.();
            }),
        ]);
        if (timer) clearTimeout(timer);
    }

    /** Waits for the handlers still running (tests, and a close that wants them done). */
    async drain(): Promise<void> {
        while (this.running.size > 0) await Promise.allSettled([...this.running]);
    }

    /** Removes every handler (tests). */
    clear(): void {
        this.handlers.clear();
        this.chains.clear();
    }

    private dispatch<K extends keyof TEvents>(
        name: K,
        payload: TEvents[K] | (() => TEvents[K]),
        key: string | undefined,
        outer?: AbortSignal
    ): Promise<void> {
        const entries = this.handlers.get(name);
        if (!entries || entries.length === 0) return Promise.resolve();
        let value: TEvents[K];
        try {
            value = typeof payload === "function" ? (payload as () => TEvents[K])() : payload;
        } catch (error) {
            this.reportError({ owner: "app", event: String(name), error, timedOut: false });
            return Promise.resolve();
        }
        const runs = entries.map((entry) => this.schedule(entry, String(name), value, key, outer));
        return Promise.all(runs).then(() => undefined);
    }

    private schedule(
        entry: Entry,
        event: string,
        payload: unknown,
        key: string | undefined,
        outer?: AbortSignal
    ): Promise<void> {
        const chainKey = `${entry.owner}\u0000${event}\u0000${key ?? ""}`;
        const previous = this.chains.get(chainKey) ?? Promise.resolve();
        const run = previous.then(() => this.runOne(entry, event, payload, outer));
        this.chains.set(chainKey, run);
        this.running.add(run);
        void run.finally(() => {
            this.running.delete(run);
            if (this.chains.get(chainKey) === run) this.chains.delete(chainKey);
        });
        return run;
    }

    private async runOne(entry: Entry, event: string, payload: unknown, outer?: AbortSignal): Promise<void> {
        const controller = new AbortController();
        const onOuterAbort = () => controller.abort();
        outer?.addEventListener("abort", onOuterAbort, { once: true });
        let timedOut = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let handling: Promise<unknown> = Promise.resolve();
        try {
            // The handler starts on a later tick: whoever emitted is never slowed by its synchronous part.
            await Promise.resolve();
            handling = Promise.resolve().then(() => entry.handler(payload, { signal: controller.signal, event }));
            await Promise.race([
                handling,
                new Promise<never>((_, reject) => {
                    timer = setTimeout(() => {
                        timedOut = true;
                        controller.abort();
                        reject(
                            new Error(`"${event}" handler took longer than ${Math.round(entry.timeoutMs / 1000)} s`)
                        );
                    }, entry.timeoutMs);
                    timer.unref?.();
                }),
            ]);
        } catch (error) {
            this.reportError({ owner: entry.owner, event, error, timedOut });
            // Out of time: its signal is aborted, and the next handler of the chain waits for it to actually end (up to
            // the grace), so the two do not run side by side.
            if (timedOut) await this.waitForEnd(handling, this.options.abortGraceMs ?? DEFAULT_ABORT_GRACE_MS);
        } finally {
            if (timer) clearTimeout(timer);
            outer?.removeEventListener("abort", onOuterAbort);
        }
    }

    /** Waits until `work` has ended (however it ended) or `ms` passed. */
    private async waitForEnd(work: Promise<unknown>, ms: number): Promise<void> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
            work.then(
                () => undefined,
                () => undefined
            ),
            new Promise<void>((resolve) => {
                timer = setTimeout(resolve, ms);
                timer.unref?.();
            }),
        ]);
        if (timer) clearTimeout(timer);
    }
}
