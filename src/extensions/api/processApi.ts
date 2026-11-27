import { spawn as nodeSpawn } from "child_process";
import { appSecrets } from "#base/appSecrets";
import { registerAgentCleanup } from "#base/agent/cleanup";
import { killProcessTree } from "#utils/killProcessTree";
import { type SpawnOptions, type SpawnResult } from "./types";

const DEFAULT_TIMEOUT_MS = 10 * 60_000;
/** What is kept of a program's output (each of stdout / stderr): the end of it, when it says more. */
const MAX_OUTPUT_CHARS = 4 * 1024 * 1024;

/** The environment a program started for an extension gets: the app's, without any credential the app keeps. */
export function childEnvironment(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
    for (const key of appSecrets.keys()) delete env[key];
    return env;
}

function keepTail(current: string, chunk: string): string {
    const next = current + chunk;
    return next.length > MAX_OUTPUT_CHARS ? next.slice(next.length - MAX_OUTPUT_CHARS) : next;
}

/**
 * `goblin.spawn`: runs a program and resolves with its exit code and output once it ends (it never rejects for a
 * non-zero exit; it rejects when the program cannot be started). Killed with the app, on `signal` and after
 * `timeoutMs`, with the programs it started (`killProcessTree`).
 */
export function spawnForExtension(
    command: string,
    args: string[] = [],
    options: SpawnOptions = {}
): Promise<SpawnResult> {
    return new Promise<SpawnResult>((resolve, reject) => {
        if (options.signal?.aborted) {
            reject(new DOMException("Aborted before starting", "AbortError"));
            return;
        }
        const child = nodeSpawn(command, args, {
            cwd: options.cwd,
            env: childEnvironment(options.env),
            windowsHide: true,
            stdio: ["pipe", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        let settled = false;
        const forget = registerAgentCleanup(() => killProcessTree(child));
        const kill = () => killProcessTree(child);
        const timer = setTimeout(kill, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        timer.unref?.();
        options.signal?.addEventListener("abort", kill, { once: true });
        const finish = (fn: () => void) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            forget();
            options.signal?.removeEventListener("abort", kill);
            fn();
        };
        child.stdout?.setEncoding("utf8");
        child.stderr?.setEncoding("utf8");
        child.stdout?.on("data", (chunk: string) => (stdout = keepTail(stdout, chunk)));
        child.stderr?.on("data", (chunk: string) => (stderr = keepTail(stderr, chunk)));
        child.on("error", (error) => finish(() => reject(error)));
        child.on("close", (code, signal) => finish(() => resolve({ code, signal, stdout, stderr })));
        child.stdin?.on("error", () => {
            /* the program closed its input early: its output says why */
        });
        if (options.input !== undefined) child.stdin?.end(options.input);
        else child.stdin?.end();
    });
}
