import { existsSync, readFileSync } from "fs";
import path from "path";

/** A program plus the arguments that must come before the caller's own. */
export interface ResolvedCommand {
    file: string;
    prefixArgs: string[];
}

/** What {@link resolveCliCommand} reads from the machine; swapped for fakes in tests. */
export interface ResolveEnv {
    platform: NodeJS.Platform;
    /** The `PATH` value. */
    pathEnv: string;
    /** The Node binary that runs `.js` entry points. */
    nodePath: string;
    exists: (file: string) => boolean;
    readText: (file: string) => string;
}

const defaultEnv = (): ResolveEnv => ({
    platform: process.platform,
    pathEnv: process.env.PATH ?? process.env.Path ?? "",
    nodePath: process.execPath,
    exists: existsSync,
    readText: (file) => readFileSync(file, "utf8"),
});

const NATIVE = [".exe", ".com"];
const SHIM = [".cmd", ".bat"];
const SCRIPT = [".js", ".mjs", ".cjs"];

/**
 * The file a package manager's `.cmd` shim runs. npm, pnpm and Yarn all write the same shape:
 * `"%dp0%\node_modules\<pkg>\cli.js" %*` (older Yarn: `"%~dp0\..\<pkg>\cli.js"`), after one or more
 * `node.exe` lines. The last quoted path that is not `node` is the target; it is relative to the shim.
 * Returns `undefined` when the shim is not of that shape.
 */
function shimTarget(shim: string, env: ResolveEnv): string | undefined {
    let text: string;
    try {
        text = env.readText(shim);
    } catch {
        return undefined;
    }
    const targets = [...text.matchAll(/"(?:%dp0%|%~dp0)[\\/]?([^"\r\n]+)"/gi)]
        .map((m) => m[1])
        .filter((rel) => !/^node(\.exe)?$/i.test(path.win32.basename(rel)));
    const rel = targets.at(-1);
    if (!rel) return undefined;
    const target = path.win32.resolve(path.win32.dirname(shim), rel);
    return env.exists(target) ? target : undefined;
}

/**
 * Candidate files for `command`: itself, or each PATH entry joined with it; with extensions if it has
 * none. A native `.exe` anywhere on PATH comes before a shim in an earlier folder, which is what Node
 * has always done (it only looks for `.exe`), so a working setup keeps working.
 */
function candidates(command: string, env: ResolveEnv): string[] {
    const hasDir = /[\\/]/.test(command);
    const ext = path.win32.extname(command).toLowerCase();
    const names = [...NATIVE, ...SHIM, ...SCRIPT].includes(ext)
        ? [command]
        : [...NATIVE, ...SHIM].map((e) => command + e);
    if (hasDir) return names;
    const dirs = env.pathEnv
        .split(";")
        .map((d) => d.trim().replace(/^"|"$/g, ""))
        .filter((d) => d !== "");
    return names.flatMap((name) => dirs.map((dir) => path.win32.join(dir, name)));
}

/**
 * Turns the user's "Claude CLI command" into something `spawn` can start without a shell.
 *
 * Node on Windows only finds `.exe` files, and refuses `.cmd` files outright (EINVAL) — yet an npm
 * install of Claude Code gives `claude.cmd`. A shell is not an option: the arguments carry a long
 * prompt and a JSON schema that `cmd.exe` would re-parse (quotes, `%VAR%`, `&`). So the shim is
 * looked up on `PATH`, read, and the program it runs is started directly: a native `.exe`, or a `.js`
 * entry point through Node. Anything that is not a `.cmd` shim (and every other OS) is returned as is.
 */
export function resolveCliCommand(command: string, env: ResolveEnv = defaultEnv()): ResolvedCommand {
    const asIs: ResolvedCommand = { file: command, prefixArgs: [] };
    if (env.platform !== "win32") return asIs;

    // A path pasted from Explorer's "Copy as path" comes quoted.
    const found = candidates(command.replace(/^"(.*)"$/, "$1"), env).find((file) => env.exists(file));
    if (!found) return asIs;

    const ext = path.win32.extname(found).toLowerCase();
    if (NATIVE.includes(ext)) return { file: found, prefixArgs: [] };
    if (SCRIPT.includes(ext)) return { file: env.nodePath, prefixArgs: [found] };
    if (!SHIM.includes(ext)) return { file: found, prefixArgs: [] };

    const target = shimTarget(found, env);
    if (!target) return { file: found, prefixArgs: [] };
    return SCRIPT.includes(path.win32.extname(target).toLowerCase())
        ? { file: env.nodePath, prefixArgs: [target] }
        : { file: target, prefixArgs: [] };
}

/** True for a path Node cannot start without a shell (a `.cmd`/`.bat` file). */
export function isShellScript(file: string): boolean {
    return SHIM.includes(path.win32.extname(file).toLowerCase());
}
