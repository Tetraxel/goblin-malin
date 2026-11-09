import { EventEmitter } from "events";
import React from "react";
import { render } from "ink";
import { afterEach } from "vitest";

/** Minimal stand-ins for the terminal streams Ink needs, so a hook can run without a real TTY. */
class FakeStdout extends EventEmitter {
    columns = 80;
    rows = 24;
    isTTY = false;
    write(): boolean {
        return true;
    }
}
class FakeStdin extends EventEmitter {
    isTTY = false;
    setEncoding(): void {}
    setRawMode(): void {}
    resume(): void {}
    pause(): void {}
    ref(): void {}
    unref(): void {}
    read(): null {
        return null;
    }
}

const mounted: Array<() => void> = [];
afterEach(() => {
    while (mounted.length > 0) mounted.pop()!();
});

export interface MountedHook<P, T> {
    /** The hook's latest return value. */
    current: () => T;
    /** Renders again with new props. */
    rerender: (props: P) => void;
}

/**
 * Runs a hook inside a real Ink tree (headless) and gives access to its latest value. Mounted hooks are
 * unmounted after each test. State updates are asynchronous: `await tick()` after calling an action.
 */
export function mountHook<P, T>(useHook: (props: P) => T, initialProps: P): MountedHook<P, T> {
    let latest: T | undefined;
    const Host = ({ hookProps }: { hookProps: P }) => {
        latest = useHook(hookProps);
        return null;
    };
    const element = (props: P) => React.createElement(Host, { hookProps: props });
    const instance = render(element(initialProps), {
        stdout: new FakeStdout() as never,
        stderr: new FakeStdout() as never,
        stdin: new FakeStdin() as never,
        debug: true,
        patchConsole: false,
        exitOnCtrlC: false,
    });
    mounted.push(() => instance.unmount());
    return { current: () => latest as T, rerender: (props) => instance.rerender(element(props)) };
}

export const tick = (ms = 20) => new Promise<void>((resolve) => setTimeout(resolve, ms));
