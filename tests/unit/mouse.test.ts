import { describe, expect, test } from "vitest";
import { extractMouseEvents } from "../../src/base/mouse/mouse";

describe("extractMouseEvents", () => {
    test("decodes a left press into 0-based coordinates", () => {
        const { events, rest } = extractMouseEvents("\u001b[<0;40;9M");
        expect(events).toEqual([
            { type: "press", button: "left", x: 39, y: 8, ctrl: false, shift: false, alt: false },
        ]);
        expect(rest).toBe("");
    });

    test("distinguishes release from press", () => {
        expect(extractMouseEvents("\u001b[<0;1;1m").events[0].type).toBe("release");
    });

    test("decodes modifiers and wheel buttons", () => {
        const { events } = extractMouseEvents("\u001b[<16;5;5M\u001b[<64;5;5M\u001b[<65;5;5M\u001b[<4;5;5M");
        expect(events.map((e) => e.button)).toEqual(["left", "wheelUp", "wheelDown", "left"]);
        expect(events[0].ctrl).toBe(true);
        expect(events[3].shift).toBe(true);
    });

    test("ignores motion reports but still strips them", () => {
        const { events, rest } = extractMouseEvents("\u001b[<35;10;10M");
        expect(events).toEqual([]);
        expect(rest).toBe("");
    });

    test("leaves keystrokes in the same chunk untouched", () => {
        const { events, rest } = extractMouseEvents("a\u001b[<0;2;3Mb");
        expect(events).toHaveLength(1);
        expect(rest).toBe("ab");
    });

    test("returns plain input unchanged", () => {
        expect(extractMouseEvents("\u001b[A")).toEqual({ events: [], rest: "\u001b[A" });
    });
});
