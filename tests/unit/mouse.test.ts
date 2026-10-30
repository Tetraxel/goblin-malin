import { describe, expect, test } from "vitest";
import { extractMouseEvents, mouseRegistry, type MouseEvent } from "../../src/base/mouse/mouse";

describe("mouseRegistry", () => {
    test("only dispatches a move when the pointer changes cell", () => {
        const received: MouseEvent[] = [];
        const unsubscribe = mouseRegistry.subscribe((event) => received.push(event));
        const move = (x: number, y: number): MouseEvent => ({
            type: "move",
            button: "none",
            x,
            y,
            ctrl: false,
            shift: false,
            alt: false,
        });

        mouseRegistry.dispatch(move(1, 1));
        mouseRegistry.dispatch(move(1, 1));
        mouseRegistry.dispatch(move(2, 1));
        unsubscribe();

        expect(received.map((e) => [e.x, e.y])).toEqual([
            [1, 1],
            [2, 1],
        ]);
    });
});

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

    test("decodes hover motion (no button held) as a move event", () => {
        const { events, rest } = extractMouseEvents("\u001b[<35;10;10M");
        expect(events).toEqual([
            { type: "move", button: "none", x: 9, y: 9, ctrl: false, shift: false, alt: false },
        ]);
        expect(rest).toBe("");
    });

    test("decodes a drag as a move with the held button", () => {
        const { events } = extractMouseEvents("\u001b[<32;3;4M");
        expect(events).toEqual([
            { type: "move", button: "left", x: 2, y: 3, ctrl: false, shift: false, alt: false },
        ]);
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
