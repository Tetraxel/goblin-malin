import React, { Profiler } from "react";
import { type Instance, type RenderOptions, render } from "ink";
import process from "node:process";
import { App } from "./components/App";
import { FullScreenBox } from "./components/FullScreenBox";
import { globalLogger } from "./base/logger/logger";
import { detectFuncKey } from "./types/actions";
import { shortcutRegistry } from "./base/shortcuts/ShortcutRegistry";
import { fpsTracker } from "./base/fpsTracker";

async function write(content: string) {
    return new Promise<void>((resolve, reject) => {
        process.stdout.write(content, (error) => {
            if (error) reject(error);
            else resolve();
        });
    });
}

async function cleanUpOnExit(instance: Instance) {
    await instance.waitUntilExit();
    await write("\x1b[?1049l");
}

type WithFullScreen = (...args: Parameters<typeof render>) => {
    instance: Instance;
    start: () => Promise<void>;
    waitUntilExit: () => Promise<void>;
};

export const withFullScreen: WithFullScreen = (node, options) => {
    const instance = render(null, options);
    const exitPromise = cleanUpOnExit(instance);
    function waitUntilExit() {
        return exitPromise;
    }

    return {
        instance: instance,
        start: async () => {
            instance.rerender(<FullScreenBox>{node}</FullScreenBox>);
        },
        waitUntilExit,
    };
};

export function start(): void {
    console.log = (...args: unknown[]) => globalLogger.info(args.join(" "));
    console.error = (...args: unknown[]) => globalLogger.error(args.join(" "));
    console.warn = (...args: unknown[]) => globalLogger.warn(args.join(" "));

    process.on("unhandledRejection", (reason, promise) => {
        globalLogger.error("Unhandled Rejection", { promise, reason });
    });

    try {
        if (process.stdin && process.stdin.isTTY) {
            process.stdin.setEncoding("utf8");
            process.stdin.resume();
        }
    } catch {
        /* ignore if stdin manipulation fails */
    }

    process.stdout.write("\x1b[?1049h"); // enter alternate screen buffer

    // In profile mode (TUI test harness), wrap the app in a single <Profiler>
    // to force ProfileMode tree-wide and forward Ink's per-frame render time.
    // The global is only set by src/profiling/install.ts; production is untouched.
    const profile = globalThis.__GOBLIN_PROFILE__;
    const tree = profile ? (
        <Profiler id="app" onRender={profile.onProfilerRender}>
            <App />
        </Profiler>
    ) : (
        <App />
    );
    const options: RenderOptions & { onRender?: (info: { renderTime: number }) => void } = {
        patchConsole: true,
        maxFps: 60,
        exitOnCtrlC: false,
    };
    options.onRender = (info) => {
        fpsTracker.recordFrame(info.renderTime);
        if (profile) profile.onInkRender(info);
    };

    // Ink zeroes `input` for function keys (they're in nonAlphanumericKeys) before
    // passing them to useInput handlers. We tap stdin with prependListener so our
    // handler fires first: read the raw chunk, dispatch any F-key shortcut, then
    // unshift the chunk back so Ink can read it normally as well.
    let isHandlingFKey = false;
    process.stdin.prependListener("readable", () => {
        if (isHandlingFKey) return; // prevent re-entry after unshift re-emits readable
        const chunk = process.stdin.read() as string | Buffer | null;
        if (chunk === null) return;
        isHandlingFKey = true;
        const str = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        const funcKey = detectFuncKey(str);
        if (funcKey !== undefined) shortcutRegistry.dispatchFuncKey(funcKey);
        process.stdin.unshift(chunk as Parameters<typeof process.stdin.unshift>[0]);
        isHandlingFKey = false;
    });

    const instance = render(tree, options);

    instance.waitUntilExit().then(() => {
        process.stdout.write("\x1b[?1049l"); // restore main screen buffer
    });
}

const GoblinMalin = { start };
export default GoblinMalin;
