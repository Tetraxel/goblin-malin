// @ts-check
/**
 * Building the command line. Pure functions (tests/unit/extensionSamples.test.ts imports this file).
 */

/** Quotes one value for the shell that runs the command, so a title like `Don't "Stop"` stays one argument. */
export function quote(value, platform = process.platform) {
    const text = String(value ?? "");
    if (platform === "win32") return `"${text.replace(/"/g, '""')}"`;
    return `'${text.replace(/'/g, `'\\''`)}'`;
}

/**
 * Replaces each `{name}` of `template` with its value, quoted. An unknown placeholder is left as it is.
 * @param {string} template
 * @param {Record<string, string | undefined>} values
 */
export function expandCommand(template, values, platform = process.platform) {
    return template.replace(/\{([a-zA-Z]+)\}/g, (whole, key) =>
        Object.prototype.hasOwnProperty.call(values, key) ? quote(values[key], platform) : whole
    );
}

/** The program and arguments that run a command line in the system's shell. */
export function shellFor(commandLine, platform = process.platform) {
    return platform === "win32"
        ? { command: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", commandLine] }
        : { command: "/bin/sh", args: ["-c", commandLine] };
}

/**
 * The command's time limits. The handler's own limit (index.js) is the event bus' longest, 10 minutes: the longest
 * choice stays well under it, so a hung command is stopped and reported by the example itself ("the command failed").
 */
export const TIMEOUTS = { "30 seconds": 30_000, "2 minutes": 120_000, "8 minutes": 480_000 };
/** The handler's limit: the bus' maximum (10 minutes). */
export const HANDLER_TIMEOUT_MS = 600_000;
