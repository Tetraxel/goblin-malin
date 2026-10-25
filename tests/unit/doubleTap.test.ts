import { describe, expect, test } from "vitest";
import type { Key } from "ink";
import { DOUBLE_TAP_MS, isDoubleTap, type LastPress } from "../../src/base/shortcuts/doubleTap";
import { getShortcutLiteral } from "../../src/types/actions";

const noKey: Key = {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageDown: false,
    pageUp: false,
    home: false,
    end: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    tab: false,
    backspace: false,
    delete: false,
    meta: false,
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
};
const press = (overrides: Partial<Key>, time: number): LastPress => ({ input: "", key: { ...noKey, ...overrides }, time });

const escTwice = { key: "escape", doubleTap: true } as const;

describe("isDoubleTap", () => {
    test("true when the previous press was the same key just before", () => {
        expect(isDoubleTap(escTwice, press({ escape: true }, 1000), 1000 + DOUBLE_TAP_MS)).toBe(true);
    });

    test("false once the gap exceeds the window", () => {
        expect(isDoubleTap(escTwice, press({ escape: true }, 1000), 1000 + DOUBLE_TAP_MS + 1)).toBe(false);
    });

    test("false when the previous press was a different key, or there was none", () => {
        expect(isDoubleTap(escTwice, press({ return: true }, 1000), 1100)).toBe(false);
        expect(isDoubleTap(escTwice, null, 1100)).toBe(false);
    });
});

describe("getShortcutLiteral", () => {
    test("shows a double-tap binding as the key twice", () => {
        expect(getShortcutLiteral([escTwice])).toBe("Esc Esc");
        expect(getShortcutLiteral([{ key: "escape" }])).toBe("Esc");
    });
});
