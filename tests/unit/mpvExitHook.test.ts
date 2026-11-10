import type { ChildProcess } from "child_process";
import { afterEach, describe, expect, test, vi } from "vitest";
import { MpvPlayer } from "#utils/mpvPlayer";

// The exit hook is private: it is driven here the way `_start` drives it, once per spawned process.
type WithHook = { mpvProcess: ChildProcess | null; installExitHook(): void };

const fakeProcess = () => ({ kill: vi.fn() }) as unknown as ChildProcess & { kill: ReturnType<typeof vi.fn> };

describe("MpvPlayer exit hook", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    test("restarting mpv does not add another process 'exit' listener", () => {
        const onceSpy = vi.spyOn(process, "once").mockImplementation(() => process);
        const player = new MpvPlayer() as unknown as WithHook;

        for (let restart = 0; restart < 20; restart++) {
            player.mpvProcess = fakeProcess();
            player.installExitHook();
        }

        expect(onceSpy.mock.calls.filter(([event]) => event === "exit")).toHaveLength(1);
    });

    test("on exit it kills the process that is current, not the first one", () => {
        let onExit: (() => void) | undefined;
        vi.spyOn(process, "once").mockImplementation(((event: string, listener: () => void) => {
            if (event === "exit") onExit = listener;
            return process;
        }) as typeof process.once);
        const player = new MpvPlayer() as unknown as WithHook;

        const first = fakeProcess();
        player.mpvProcess = first;
        player.installExitHook();
        const second = fakeProcess();
        player.mpvProcess = second;
        player.installExitHook();

        onExit?.();

        expect(second.kill).toHaveBeenCalledTimes(1);
        expect(first.kill).not.toHaveBeenCalled();
    });
});
