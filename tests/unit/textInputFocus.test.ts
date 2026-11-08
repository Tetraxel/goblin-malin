import { describe, expect, test } from "vitest";
import { textInputFocus } from "../../src/base/textInputFocus";

describe("textInputFocus", () => {
    test("is focused while any field holds it, and each release counts once", () => {
        expect(textInputFocus.isFocused()).toBe(false);
        const a = textInputFocus.acquire();
        const b = textInputFocus.acquire();
        a();
        a();
        expect(textInputFocus.isFocused()).toBe(true);
        b();
        expect(textInputFocus.isFocused()).toBe(false);
    });

    test("a Ctrl+letter chunk marks the key press; typed text, Enter, Tab and Backspace do not", () => {
        for (const chunk of ["a", "\r", "\t", "\x08", "hello", "\x1b[A"]) {
            textInputFocus.noteRawInput(chunk);
            expect(textInputFocus.isControlKeyPress()).toBe(false);
        }
        textInputFocus.noteRawInput("\x11"); // Ctrl+Q
        expect(textInputFocus.isControlKeyPress()).toBe(true);
    });
});
