import { describe, expect, it } from "vitest";
import {
    isTerminalTooSmall,
    MIN_TERMINAL_HEIGHT,
    MIN_TERMINAL_WIDTH,
    terminalTooSmallMessage,
} from "../../src/utils/terminalSize";

describe("isTerminalTooSmall", () => {
    it("accepts the minimum size and anything larger", () => {
        expect(isTerminalTooSmall(MIN_TERMINAL_WIDTH, MIN_TERMINAL_HEIGHT)).toBe(false);
        expect(isTerminalTooSmall(200, 50)).toBe(false);
    });

    it("rejects a terminal too narrow or too short", () => {
        expect(isTerminalTooSmall(MIN_TERMINAL_WIDTH - 1, 50)).toBe(true);
        expect(isTerminalTooSmall(200, MIN_TERMINAL_HEIGHT - 1)).toBe(true);
        expect(isTerminalTooSmall(20, 8)).toBe(true);
    });

    it("never blocks when the size is unknown (no TTY)", () => {
        expect(isTerminalTooSmall(undefined, undefined)).toBe(false);
    });
});

describe("terminalTooSmallMessage", () => {
    it("states the minimum and the current size", () => {
        expect(terminalTooSmallMessage(60, 20)).toBe("▵ Terminal too small : need at least 66×16 (now 60×20)");
    });
});
