import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { resolveKey, bracketedPaste } from "../../scripts/tui-test/keyMap.ts";
import {
    colorMatches,
    countMatches,
    cropRegion,
    findAll,
    lineDiff,
    maskText,
    plainLine,
    regionText,
    styleMismatch,
    toLines,
    type CellStyle,
} from "../../scripts/tui-test/matchers.ts";
import { checkJsonValue, getPath } from "../../scripts/tui-test/jsonPath.ts";
import { mouseDrag, mouseMove, mousePress, mouseRelease, mouseWheel } from "../../scripts/tui-test/mouse.ts";
import { parseScenario } from "../../scripts/tui-test/parseScenario.ts";
import { createIsolatedDataDir } from "../../scripts/tui-test/isolatedDataDir.ts";

const ESC = "\u001b";

describe("tui harness: keys", () => {
    test("keeps the named keys and single characters", () => {
        expect(resolveKey("Enter")).toBe("\r");
        expect(resolveKey("Ctrl+Q")).toBe("\u0011");
        expect(resolveKey("D")).toBe("D");
    });

    test("any Ctrl+letter is its control code", () => {
        expect(resolveKey("Ctrl+B")).toBe("\u0002");
        expect(resolveKey("Ctrl+W")).toBe("\u0017");
        expect(resolveKey("Ctrl+[")).toBe(ESC);
    });

    test("modified cursor keys use the xterm modifier parameter", () => {
        expect(resolveKey("Ctrl+←")).toBe(`${ESC}[1;5D`);
        expect(resolveKey("Alt+Right")).toBe(`${ESC}[1;3C`);
        expect(resolveKey("Ctrl+Shift+Left")).toBe(`${ESC}[1;6D`);
        expect(resolveKey("Shift+Home")).toBe(`${ESC}[1;2H`);
        expect(resolveKey("Ctrl+Delete")).toBe(`${ESC}[3;5~`);
    });

    test("function keys, plain and modified", () => {
        expect(resolveKey("F1")).toBe(`${ESC}OP`);
        expect(resolveKey("F5")).toBe(`${ESC}[15~`);
        expect(resolveKey("F12")).toBe(`${ESC}[24~`);
        expect(resolveKey("Shift+F3")).toBe(`${ESC}[1;2R`);
        expect(resolveKey("Ctrl+F5")).toBe(`${ESC}[15;5~`);
    });

    test("Alt puts an Escape first", () => {
        expect(resolveKey("Alt+x")).toBe(`${ESC}x`);
        expect(resolveKey("Alt+Enter")).toBe(`${ESC}\r`);
        expect(resolveKey("Ctrl+Alt+a")).toBe(`${ESC}\u0001`);
    });

    test("a modifier combination that cannot be read is an error, not typed text", () => {
        expect(() => resolveKey("Ctrl+Nope")).toThrow(/Unknown key/);
    });

    test("bracketed paste wraps the text", () => {
        expect(bracketedPaste("hi")).toBe(`${ESC}[200~hi${ESC}[201~`);
    });
});

describe("tui harness: finding text on the screen", () => {
    const screen = ["┌── Settings ──┐", "│ 12 tracks    │", "│ 3 tracks     │", "└──────────────┘"].join("\n");
    const lines = toLines(screen);

    test("contains: count and location (1-based)", () => {
        const [first] = findAll(lines, { contains: "Settings" });
        expect(first).toMatchObject({ row: 1, col: 5, width: 8 });
        expect(countMatches(lines, { contains: "tracks" })).toBe(2);
        expect(countMatches(lines, { contains: "nope" })).toBe(0);
    });

    test("matches: a regular expression, per line by default", () => {
        expect(findAll(lines, { matches: "\\d+ tracks" }).map((m) => m.text)).toEqual(["12 tracks", "3 tracks"]);
        expect(countMatches(lines, { matches: "^│ 3 " })).toBe(1);
    });

    test("row and region limit where to look", () => {
        expect(countMatches(lines, { contains: "tracks", row: 2 })).toBe(1);
        expect(findAll(lines, { contains: "tracks", row: 3 })[0]).toMatchObject({ row: 3, col: 5 });
        expect(countMatches(lines, { contains: "Settings", region: { row: 2, col: 1, width: 16, height: 3 } })).toBe(0);
        expect(findAll(lines, { contains: "3", region: { row: 3, col: 3, width: 5, height: 1 } })[0]).toMatchObject({
            row: 3,
            col: 3,
        });
    });

    test("wide characters do not shift the columns of what follows", () => {
        // "😉" takes cells 0-1: the "G" after it is in column 3 (0-based 3, 1-based 4)
        const line = { text: "😉 Goblin", colOf: [0, 0, 2, 3, 4, 5, 6, 7, 8] };
        expect(findAll([line], { contains: "Goblin" })[0]).toMatchObject({ row: 1, col: 4, width: 6 });
    });

    test("a match needs exactly one of contains / matches", () => {
        expect(() => findAll(lines, {})).toThrow();
        expect(() => findAll(lines, { contains: "a", matches: "b" })).toThrow();
    });

    test("cropRegion and regionText cut by cell", () => {
        expect(cropRegion(lines, { row: 2, col: 3, width: 6, height: 1 })[0]?.text).toBe("12 tra");
        expect(regionText(lines, { row: 1, col: 1, width: 4, height: 2 })).toBe("┌──\n│ 12");
        expect(regionText([plainLine("a"), plainLine(""), plainLine("")])).toBe("a");
    });
});

describe("tui harness: golden snapshots", () => {
    test("equal texts have no diff", () => {
        expect(lineDiff("a\nb", "a\nb")).toBe("");
    });

    test("an inserted line does not mark the ones below as changed", () => {
        const diff = lineDiff("a\nb\nc\nd\ne\nf\ng", "a\nNEW\nb\nc\nd\ne\nf\ng", 1);
        expect(diff).toContain("+ NEW");
        expect(diff).not.toContain("- b");
    });

    test("a changed line shows both sides", () => {
        expect(lineDiff("x\nold\ny", "x\nnew\ny")).toBe("  x\n- old\n+ new\n  y");
    });

    test("masks hide what changes from run to run", () => {
        expect(maskText("took 1234ms, v0.3.0", ["\\d+ms", "v\\d+\\.\\d+\\.\\d+"])).toBe("took ‹*›, ‹*›");
        expect(maskText("same", undefined)).toBe("same");
    });
});

describe("tui harness: styles", () => {
    const style = (over: Partial<CellStyle> = {}): CellStyle => ({
        fg: { kind: "default" },
        bg: { kind: "default" },
        bold: false,
        dim: false,
        italic: false,
        underline: false,
        inverse: false,
        strikethrough: false,
        ...over,
    });

    test("colours: default, palette index, rgb, and a palette colour read as rgb", () => {
        expect(colorMatches({ kind: "default" }, "default")).toBe(true);
        expect(colorMatches({ kind: "palette", index: 2 }, 2)).toBe(true);
        expect(colorMatches({ kind: "palette", index: 2 }, 3)).toBe(false);
        expect(colorMatches({ kind: "rgb", rgb: [255, 0, 81] }, "#ff0051")).toBe(true);
        expect(colorMatches({ kind: "palette", index: 9 }, "#ff0000")).toBe(true);
        expect(colorMatches({ kind: "default" }, "#ff0000")).toBe(false);
        expect(() => colorMatches({ kind: "default" }, "red")).toThrow();
    });

    test("reports what differs", () => {
        expect(styleMismatch(style({ dim: true }), { dim: true })).toBe("");
        expect(styleMismatch(style(), { dim: true, fg: "#ffffff" })).toBe(
            "fg is default, wanted #ffffff; dim is false, wanted true"
        );
    });
});

describe("tui harness: JSON paths", () => {
    const doc = { music: { download: { outputDir: "x" } }, sessions: [{ name: "a", tasks: [1, 2, 3] }, { name: "b" }] };

    test("reads dotted and indexed paths", () => {
        expect(getPath(doc, "music.download.outputDir")).toBe("x");
        expect(getPath(doc, "sessions[0].tasks.length")).toBe(3);
        expect(getPath(doc, "sessions.1.name")).toBe("b");
        expect(getPath(doc, "sessions.-1.name")).toBe("b");
        expect(getPath(doc, "music.nope.deeper")).toBeUndefined();
    });

    test("reads a quoted key that has dots in it (a shortcut id)", () => {
        const settings = { keybindings: { "sessionsModal.new": { input: "b", ctrl: true } }, "a]b": 1 };
        expect(getPath(settings, 'keybindings["sessionsModal.new"].input')).toBe("b");
        expect(getPath(settings, "keybindings['sessionsModal.new'].ctrl")).toBe(true);
        expect(getPath(settings, '["a]b"]')).toBe(1);
        expect(getPath(settings, "keybindings.sessionsModal.new")).toBeUndefined();
        expect(getPath(doc, "sessions[-1].name")).toBe("b");
    });

    test("checks a value", () => {
        expect(checkJsonValue(3, { equals: 3, gte: 2, lt: 4 })).toBe("");
        expect(checkJsonValue([1, { a: 1 }], { contains: { a: 1 }, length: 2 })).toBe("");
        expect(checkJsonValue("hello", { matches: "^he", contains: "ell" })).toBe("");
        expect(checkJsonValue(undefined, { exists: false })).toBe("");
        expect(checkJsonValue(2, { equals: 3 })).toBe("is 2, wanted 3");
        expect(checkJsonValue(undefined, { exists: true })).toBe("does not exist");
        expect(checkJsonValue(1, { gt: 5 })).toContain("is not gt 5");
    });
});

describe("tui harness: mouse", () => {
    test("press, release, motion, wheel, hover", () => {
        expect(mousePress({ col: 5, row: 3 })).toBe(`${ESC}[<0;5;3M`);
        expect(mouseRelease({ col: 5, row: 3 }, "right")).toBe(`${ESC}[<2;5;3m`);
        expect(mousePress({ col: 1, row: 1 }, "left", { alt: true, ctrl: true })).toBe(`${ESC}[<24;1;1M`);
        expect(mouseWheel({ col: 2, row: 2 }, "up")).toBe(`${ESC}[<64;2;2M`);
        expect(mouseWheel({ col: 2, row: 2 }, "down")).toBe(`${ESC}[<65;2;2M`);
        expect(mouseMove({ col: 4, row: 4 })).toBe(`${ESC}[<35;4;4M`);
    });

    test("a drag is a press, motion on the way, and a release", () => {
        const events = mouseDrag({ col: 10, row: 5 }, { col: 14, row: 5 });
        expect(events[0]).toBe(`${ESC}[<0;10;5M`);
        expect(events.slice(1, -1)).toEqual([11, 12, 13, 14].map((c) => `${ESC}[<32;${c};5M`));
        expect(events.at(-1)).toBe(`${ESC}[<0;14;5m`);
    });
});

describe("tui harness: scenario files", () => {
    test("comments and new steps parse", () => {
        const scenario = parseScenario(`{
            // a comment
            "network": { "rules": [{ "url": "https://x/y", "json": { "a": 1 } }] },
            "steps": [{ "type": "assertNot", "contains": "//not a comment" }]
        }`);
        expect(scenario.network?.rules?.[0]?.url).toBe("https://x/y");
        expect(scenario.steps[0]).toEqual({ type: "assertNot", contains: "//not a comment" });
    });
});

describe("tui harness: the throwaway data folder", () => {
    /** A fixture folder holding `settings`, and the settings the app would read from its isolated copy. */
    function isolate(settings: unknown, patch?: Record<string, unknown>) {
        const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-fixture-"));
        fs.writeFileSync(path.join(fixture, "settings.json"), JSON.stringify(settings));
        const copy = createIsolatedDataDir(fixture, patch);
        try {
            const written = JSON.parse(fs.readFileSync(path.join(copy.dir, "settings.json"), "utf-8"));
            return { dir: copy.dir, written };
        } finally {
            copy.dispose();
            fs.rmSync(fixture, { recursive: true, force: true });
        }
    }

    test("an old-layout fixture patched under `music` keeps its music folders inside the copy", () => {
        const legacy = {
            flows: { "music-downloader": { metadata: { providers: { spotify: { enabled: true } } } } },
        };
        const { dir, written } = isolate(legacy, {
            music: { metadata: { discoveryProviders: { songlink: { enabled: false } } } },
        });
        // One `music` section (the app ignores `flows` as soon as there is one), with everything of both.
        expect(written.flows).toBeUndefined();
        expect(written.music.metadata.providers.spotify.enabled).toBe(true);
        expect(written.music.metadata.discoveryProviders.songlink.enabled).toBe(false);
        expect(written.music.download.outputTemporaryDir).toBe(path.join(dir, "tmp"));
        expect(written.music.download.outputDir).toBe(path.join(dir, "output"));
        expect(written.music.onboarding.providersChosen).toBe(true);
    });

    test("a patch cannot point the app at the user's real folders", () => {
        const { dir, written } = isolate(
            { music: {} },
            { music: { download: { outputTemporaryDir: "C:/Users/someone/Music/GoblinMalin/tmp" } } }
        );
        expect(written.music.download.outputTemporaryDir).toBe(path.join(dir, "tmp"));
    });

    test("the first-run picker stays as the fixture or the patch says", () => {
        expect(isolate({}).written.music.onboarding.providersChosen).toBe(true);
        const asked = isolate({}, { music: { onboarding: { providersChosen: false } } });
        expect(asked.written.music.onboarding.providersChosen).toBe(false);
    });
});
