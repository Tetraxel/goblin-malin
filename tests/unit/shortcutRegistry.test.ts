import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Key } from "ink";
import type { Shortcut } from "#types/actions";
import { matchesShortcut } from "#types/actions";
import { makeKey } from "./helpers/keys";

// The registry persists shortcut stubs through the cache (under GOBLIN_DATA_DIR, resolved when #constants
// loads), so point it at a temp dir before importing.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-shortcuts-test-"));
process.env.GOBLIN_DATA_DIR = dataDir;
const { shortcutRegistry } = await import("#base/shortcuts/ShortcutRegistry");
type ShortcutEntry = import("#base/shortcuts/ShortcutRegistry").ShortcutEntry;
type HintLineEntry = import("#base/shortcuts/ShortcutRegistry").HintLineEntry;

afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const entry = (id: string, shortcut: Shortcut, handler: () => void | Promise<void>): ShortcutEntry => ({
    id,
    defaultShortcut: shortcut,
    shortcut,
    label: id,
    handler,
});

let cleanups: Array<() => void> = [];
/** Registers a context and unregisters it after the test. */
function register(
    contextId: string,
    shortcuts: ShortcutEntry[],
    options: { priority?: number; active?: boolean; exclusive?: boolean; hintLines?: HintLineEntry[] } = {}
): void {
    cleanups.push(
        shortcutRegistry.register(
            contextId,
            shortcuts,
            options.hintLines ?? [],
            options.active ?? true,
            options.priority ?? 0,
            options.exclusive ?? false
        )
    );
}
afterEach(() => {
    cleanups.forEach((fn) => fn());
    cleanups = [];
    shortcutRegistry.disableRebind();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe("matchesShortcut", () => {
    test("a character shortcut with no shift given matches either case", () => {
        expect(matchesShortcut({ input: "f" }, "f", makeKey())).toBe(true);
        expect(matchesShortcut({ input: "f" }, "F", makeKey({ shift: true }))).toBe(true);
        expect(matchesShortcut({ input: "f" }, "g", makeKey())).toBe(false);
    });

    test("ctrl must match for a character shortcut when it is specified", () => {
        expect(matchesShortcut({ input: "v", ctrl: true }, "v", makeKey({ ctrl: true }))).toBe(true);
        expect(matchesShortcut({ input: "v", ctrl: true }, "v", makeKey())).toBe(false);
        expect(matchesShortcut({ input: "v", ctrl: false }, "v", makeKey({ ctrl: true }))).toBe(false);
    });

    test("an explicit shift is compared exactly", () => {
        expect(matchesShortcut({ input: "A", shift: true }, "A", makeKey({ shift: true }))).toBe(true);
        expect(matchesShortcut({ input: "A", shift: true }, "a", makeKey({ shift: true }))).toBe(false);
        expect(matchesShortcut({ input: "a", shift: false }, "a", makeKey({ shift: true }))).toBe(false);
    });

    test("a named key does not fire with a modifier the shortcut did not ask for", () => {
        expect(matchesShortcut({ key: "leftArrow" }, "", makeKey({ leftArrow: true }))).toBe(true);
        expect(matchesShortcut({ key: "leftArrow" }, "", makeKey({ leftArrow: true, shift: true }))).toBe(false);
        expect(matchesShortcut({ key: "leftArrow", shift: true }, "", makeKey({ leftArrow: true, shift: true }))).toBe(
            true
        );
        expect(matchesShortcut({ key: "return" }, "", makeKey({ return: true, ctrl: true }))).toBe(false);
    });

    test("a shortcut with neither input nor key never matches", () => {
        expect(matchesShortcut({ funcKey: 2 }, "", makeKey())).toBe(false);
    });
});

describe("shortcutRegistry.dispatch", () => {
    const press = (input: string, key: Key = makeKey()) => shortcutRegistry.dispatch(input, key);

    test("the highest-priority active context wins and the key is consumed", () => {
        const fired: string[] = [];
        register("low", [entry("low.x", { input: "x" }, () => void fired.push("low"))], { priority: 1 });
        register("high", [entry("high.x", { input: "x" }, () => void fired.push("high"))], { priority: 5 });
        press("x");
        expect(fired).toEqual(["high"]);
    });

    test("a context that does not match lets the key fall through to a lower one", () => {
        const fired: string[] = [];
        register("low", [entry("low.x", { input: "x" }, () => void fired.push("low"))], { priority: 1 });
        register("high", [entry("high.y", { input: "y" }, () => void fired.push("high"))], { priority: 5 });
        press("x");
        expect(fired).toEqual(["low"]);
    });

    test("an inactive context is skipped", () => {
        const fired: string[] = [];
        register("high", [entry("high.x", { input: "x" }, () => void fired.push("high"))], {
            priority: 5,
            active: false,
        });
        register("low", [entry("low.x", { input: "x" }, () => void fired.push("low"))], { priority: 1 });
        press("x");
        expect(fired).toEqual(["low"]);
    });

    test("an exclusive context blocks lower ones even when nothing matches", () => {
        const fired: string[] = [];
        register("modal", [entry("modal.y", { input: "y" }, () => void fired.push("modal"))], {
            priority: 9,
            exclusive: true,
        });
        register("page", [entry("page.x", { input: "x" }, () => void fired.push("page"))], { priority: 1 });
        press("x");
        expect(fired).toEqual([]);
        press("y");
        expect(fired).toEqual(["modal"]);
    });

    test("update() swaps in the latest handler, so a stale closure never fires", () => {
        const fired: string[] = [];
        register("ctx", [entry("ctx.x", { input: "x" }, () => void fired.push("old"))]);
        shortcutRegistry.update("ctx", [entry("ctx.x", { input: "x" }, () => void fired.push("new"))], [], true);
        press("x");
        expect(fired).toEqual(["new"]);
    });

    test("update() can deactivate a context", () => {
        const fired: string[] = [];
        const e = entry("ctx.x", { input: "x" }, () => void fired.push("x"));
        register("ctx", [e]);
        shortcutRegistry.update("ctx", [e], [], false);
        press("x");
        expect(fired).toEqual([]);
    });

    test("an unregistered context no longer fires", () => {
        const fired: string[] = [];
        const unregister = shortcutRegistry.register(
            "gone",
            [entry("gone.x", { input: "x" }, () => void fired.push("x"))],
            [],
            true,
            0
        );
        unregister();
        press("x");
        expect(fired).toEqual([]);
        expect(shortcutRegistry.hasContext("gone")).toBe(false);
    });

    test("a handler that throws is reported and does not break the dispatch", () => {
        const errors = vi.spyOn(console, "error").mockImplementation(() => {});
        const fired: string[] = [];
        register("bad", [
            entry("bad.x", { input: "x" }, () => {
                throw new Error("boom");
            }),
            entry("bad.y", { input: "y" }, () => void fired.push("y")),
        ]);
        expect(() => press("x")).not.toThrow();
        expect(errors).toHaveBeenCalled();
        press("y");
        expect(fired).toEqual(["y"]);
    });

    test("rebind capture takes every key, runs no handler and stops when disabled", () => {
        const fired: string[] = [];
        const captured: string[] = [];
        register("ctx", [entry("ctx.x", { input: "x" }, () => void fired.push("x"))]);
        shortcutRegistry.enableRebind((input) => void captured.push(input));
        press("x");
        shortcutRegistry.dispatchFuncKey(2);
        expect(captured).toEqual(["x"]);
        expect(fired).toEqual([]);
        shortcutRegistry.disableRebind();
        press("x");
        expect(fired).toEqual(["x"]);
    });
});

describe("shortcutRegistry double-tap", () => {
    const press = (input: string) => shortcutRegistry.dispatch(input, makeKey());

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
        // The registry is a singleton that remembers the last key pressed: forget the previous test's.
        shortcutRegistry.dispatch("", makeKey());
        vi.advanceTimersByTime(5000);
    });

    function bindSingleAndDouble(fired: string[]): void {
        register("page", [entry("page.single", { input: "q" }, () => void fired.push("single"))], { priority: 9 });
        register("global", [entry("global.double", { input: "q", doubleTap: true }, () => void fired.push("double"))], {
            priority: 1,
        });
    }

    test("the second tap within the window beats a higher-priority single-press binding", () => {
        const fired: string[] = [];
        bindSingleAndDouble(fired);
        press("q");
        vi.advanceTimersByTime(200);
        press("q");
        expect(fired).toEqual(["single", "double"]);
    });

    test("a second tap that comes too late is just another single press", () => {
        const fired: string[] = [];
        bindSingleAndDouble(fired);
        press("q");
        vi.advanceTimersByTime(900);
        press("q");
        expect(fired).toEqual(["single", "single"]);
    });

    test("a third tap starts a new pair instead of firing the double-tap again", () => {
        const fired: string[] = [];
        bindSingleAndDouble(fired);
        press("q");
        vi.advanceTimersByTime(100);
        press("q");
        vi.advanceTimersByTime(100);
        press("q");
        expect(fired).toEqual(["single", "double", "single"]);
    });

    test("another key in between breaks the pair", () => {
        const fired: string[] = [];
        bindSingleAndDouble(fired);
        press("q");
        vi.advanceTimersByTime(100);
        press("z");
        vi.advanceTimersByTime(100);
        press("q");
        expect(fired).toEqual(["single", "single"]);
    });

    test("a double-tap binding never fires on a single press", () => {
        const fired: string[] = [];
        register("global", [entry("global.double", { input: "q", doubleTap: true }, () => void fired.push("double"))]);
        press("q");
        expect(fired).toEqual([]);
    });

    test("an exclusive context in front still blocks the double-tap", () => {
        const fired: string[] = [];
        register("global", [entry("global.double", { input: "q", doubleTap: true }, () => void fired.push("double"))], {
            priority: 1,
        });
        register("modal", [], { priority: 9, exclusive: true });
        press("q");
        vi.advanceTimersByTime(100);
        press("q");
        expect(fired).toEqual([]);
    });
});

describe("shortcutRegistry.dispatchFuncKey", () => {
    test("fires the matching function-key binding of the highest-priority active context", () => {
        const fired: string[] = [];
        register("low", [entry("low.f2", { funcKey: 2 }, () => void fired.push("low"))], { priority: 1 });
        register("high", [entry("high.f2", { funcKey: 2 }, () => void fired.push("high"))], { priority: 5 });
        shortcutRegistry.dispatchFuncKey(2);
        shortcutRegistry.dispatchFuncKey(3);
        expect(fired).toEqual(["high"]);
    });

    test("an exclusive context blocks lower function-key bindings", () => {
        const fired: string[] = [];
        register("low", [entry("low.f2", { funcKey: 2 }, () => void fired.push("low"))], { priority: 1 });
        register("modal", [], { priority: 9, exclusive: true });
        shortcutRegistry.dispatchFuncKey(2);
        expect(fired).toEqual([]);
    });
});

describe("shortcutRegistry lookups", () => {
    test("getDefaultShortcut still answers after the owning context unmounts (persisted stub)", () => {
        const unregister = shortcutRegistry.register(
            "settings",
            [entry("lookup.save", { input: "s", ctrl: true }, () => {})],
            [],
            true,
            0
        );
        expect(shortcutRegistry.getDefaultShortcut("lookup.save")).toEqual({ input: "s", ctrl: true });
        unregister();
        expect(shortcutRegistry.getDefaultShortcut("lookup.save")).toEqual({ input: "s", ctrl: true });
        expect(shortcutRegistry.getDefaultShortcut("lookup.never-registered")).toBeUndefined();
    });

    test("getAllEntries lists a live shortcut once, and an unmounted one from its stub", () => {
        register("a", [entry("entries.live", { input: "a" }, () => {})]);
        const unregister = shortcutRegistry.register(
            "b",
            [entry("entries.stub", { input: "b" }, () => {})],
            [],
            true,
            0
        );
        unregister();
        const ids = shortcutRegistry.getAllEntries().map((e) => e.entry.id);
        expect(ids.filter((id) => id === "entries.live")).toHaveLength(1);
        expect(ids.filter((id) => id === "entries.stub")).toHaveLength(1);
    });

    test("getActiveHintContexts keeps only active contexts that have hint lines, highest priority first", () => {
        const line = (id: string): HintLineEntry => ({ id, left: { type: "text", value: id }, shortcutIds: [] });
        register("hints.low", [], { priority: 1, hintLines: [line("l")] });
        register("hints.high", [], { priority: 7, hintLines: [line("h")] });
        register("hints.silent", [], { priority: 9 });
        register("hints.off", [], { priority: 8, active: false, hintLines: [line("o")] });
        const ids = shortcutRegistry.getActiveHintContexts().map((c) => c.contextId);
        expect(ids.filter((id) => id.startsWith("hints."))).toEqual(["hints.high", "hints.low"]);
    });
});

describe("shortcutRegistry.subscribe", () => {
    test("notifies when the visible hint view changes and not when an update changes nothing", () => {
        const listener = vi.fn();
        const unsubscribe = shortcutRegistry.subscribe(listener);
        const e = entry("sub.x", { input: "x" }, () => {});
        register("sub", [e]);
        expect(listener).toHaveBeenCalledTimes(1);

        shortcutRegistry.update("sub", [{ ...e, handler: () => {} }], [], true); // new closure, same view
        expect(listener).toHaveBeenCalledTimes(1);

        shortcutRegistry.update("sub", [e], [], false); // hidden
        expect(listener).toHaveBeenCalledTimes(2);

        unsubscribe();
        shortcutRegistry.update("sub", [e], [], true);
        expect(listener).toHaveBeenCalledTimes(2);
    });
});
