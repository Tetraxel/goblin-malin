import { describe, expect, test } from "vitest";
import { wrapText } from "#utils/wrapText";
import { pasteRouter } from "#base/pasteRouter";

describe("wrapText", () => {
    test("breaks between words and never exceeds the width", () => {
        const lines = wrapText("It is the official release by Orelsan with the same duration", 20, 5);
        expect(lines).toEqual(["It is the official", "release by Orelsan", "with the same", "duration"]);
        for (const l of lines) expect(l.length).toBeLessThanOrEqual(20);
    });

    test("short text is one line, empty text is none", () => {
        expect(wrapText("Official upload.", 40, 3)).toEqual(["Official upload."]);
        expect(wrapText("   ", 40, 3)).toEqual([]);
    });

    test("more text than lines: the last line ends with an ellipsis, and still fits", () => {
        const lines = wrapText("one two three four five six seven eight nine ten eleven twelve", 12, 2);
        expect(lines).toHaveLength(2);
        expect(lines[1].endsWith("…")).toBe(true);
        for (const l of lines) expect(Array.from(l).length).toBeLessThanOrEqual(12);
    });

    test("text that fits exactly in the allowed lines is not cut", () => {
        expect(wrapText("aaa bbb ccc", 7, 2)).toEqual(["aaa bbb", "ccc"]);
    });

    test("line breaks count as spaces, and a word longer than a line is cut, not lost", () => {
        expect(wrapText("first\nsecond", 20, 3)).toEqual(["first second"]);
        const lines = wrapText("supercalifragilistic", 8, 5);
        expect(lines.join("")).toBe("supercalifragilistic");
        expect(lines.every((l) => l.length <= 8)).toBe(true);
    });

    test("a single line allowed: the text is cut with an ellipsis", () => {
        expect(wrapText("a long explanation that cannot fit", 10, 1)).toEqual(["a long…"]);
    });
});

describe("pasteRouter", () => {
    test("nobody registered: the paste is not claimed (the import dialog opens)", () => {
        expect(pasteRouter.route("https://open.spotify.com/track/abc")).toBe(false);
    });

    test("a registered handler that takes the text claims it; unregistering gives the paste back", () => {
        const seen: string[] = [];
        const off = pasteRouter.register((text) => (seen.push(text), true));
        expect(pasteRouter.route("https://a.test/x")).toBe(true);
        expect(seen).toEqual(["https://a.test/x"]);
        off();
        expect(pasteRouter.route("https://a.test/x")).toBe(false);
        expect(seen).toHaveLength(1);
    });

    test("the newest handler is asked first; one that declines passes it on", () => {
        const order: string[] = [];
        const offOld = pasteRouter.register(() => (order.push("old"), true));
        const offNew = pasteRouter.register(() => (order.push("new"), false));
        expect(pasteRouter.route("x")).toBe(true);
        expect(order).toEqual(["new", "old"]);
        offNew();
        offOld();
    });

    test("a handler that throws never swallows the paste", () => {
        const offOld = pasteRouter.register(() => true);
        const offBad = pasteRouter.register(() => {
            throw new Error("boom");
        });
        expect(pasteRouter.route("x")).toBe(true);
        offBad();
        offOld();
    });

    test("unregistering twice is harmless", () => {
        const off = pasteRouter.register(() => true);
        off();
        expect(() => off()).not.toThrow();
        expect(pasteRouter.route("x")).toBe(false);
    });
});

describe("textSummary", () => {
    test("clipText keeps short text, collapses whitespace, and cuts long text at a word", async () => {
        const { clipText } = await import("#utils/textSummary");
        expect(clipText("  short   text ", 50)).toBe("short text");
        const cut = clipText("alpha beta gamma delta epsilon zeta", 20);
        expect(cut).toBe("alpha beta gamma…");
        expect(cut.length).toBeLessThanOrEqual(20);
    });

    test("firstSentence", async () => {
        const { firstSentence } = await import("#utils/textSummary");
        expect(firstSentence("One. Two. Three.")).toBe("One.");
        expect(firstSentence("No end here")).toBe("No end here");
        expect(firstSentence("Version 1.2 is out! Then more")).toBe("Version 1.2 is out!");
    });
});
