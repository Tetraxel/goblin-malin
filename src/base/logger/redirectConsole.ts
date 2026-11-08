import { globalLogger } from "./logger";

/**
 * Sends `console.log/error/warn` to the app log instead of the terminal, where they would draw over the TUI.
 * It replaces globals, so it is called by the app's own entry points (`cli.ts`, the profiling entry) and
 * never by `start()`: code that imports `GoblinMalin.start()` as a library keeps its own console.
 */
export function redirectConsoleToLog(): void {
    console.log = (...args: unknown[]) => globalLogger.info(args.join(" "));
    console.error = (...args: unknown[]) => globalLogger.error(args.join(" "));
    console.warn = (...args: unknown[]) => globalLogger.warn(args.join(" "));
}
