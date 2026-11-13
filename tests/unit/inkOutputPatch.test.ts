import { describe, expect, test } from "vitest";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * `patches/ink/output.js` must produce exactly the strings of the stock Ink 8.0.0 `output.js` (PERF2-01): the same
 * random frames, with clips, styles, wide characters and overlapping writes, go through both, frame after frame so
 * the cross-frame caches are exercised.
 */
interface OutputLike {
    write(x: number, y: number, text: string, options: { transformers: Array<(s: string, i: number) => string> }): void;
    clip(clip: { x1?: number; x2?: number; y1?: number; y2?: number }): void;
    unclip(): void;
    get(): { output: string; height: number };
}
type OutputClass = new (options: { width: number; height: number }) => OutputLike;

const importPatch = async (file: string): Promise<Record<string, unknown>> =>
    (await import(pathToFileURL(path.resolve(__dirname, "../../patches/ink", file)).href)) as Record<string, unknown>;

const load = async (file: string): Promise<OutputClass> =>
    ((await import(pathToFileURL(path.resolve(__dirname, "../../patches/ink", file)).href)) as { default: OutputClass })
        .default;

// A tiny seeded generator, so a failure is reproducible.
function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const ESC = "\u001B";
const WORDS = [
    "Hello",
    "a track title",
    "日本語のタイトル",
    "漢字かな交じり",
    "emoji 🎵 and 👩‍👩‍👧",
    "é combining",
    "  padded  ",
    "x",
    "line one\nline two\nthree",
    `${ESC}[31mred${ESC}[39m plain`,
    `${ESC}[1m${ESC}[48;2;10;20;30mbold on bg${ESC}[49m${ESC}[22m`,
    `${ESC}[38;2;255;0;128mtruecolor${ESC}[39m 漢字`,
    `${ESC}[44m${" ".repeat(12)}${ESC}[49m`,
    "​zero​width",
    "tab\there",
];

type Op =
    | { kind: "write"; x: number; y: number; text: string; transform: boolean }
    | { kind: "clip"; clip: { x1?: number; x2?: number; y1?: number; y2?: number } }
    | { kind: "unclip" };

function makeFrame(random: () => number, width: number, height: number): Op[] {
    const int = (n: number) => Math.floor(random() * n);
    const ops: Op[] = [];
    let depth = 0;
    const count = 20 + int(40);
    for (let i = 0; i < count; i++) {
        const r = random();
        if (r < 0.15 && depth < 3) {
            const x1 = int(width) - 2;
            const y1 = int(height) - 1;
            ops.push({
                kind: "clip",
                clip: {
                    x1: random() < 0.9 ? x1 : undefined,
                    x2: random() < 0.9 ? x1 + 1 + int(width) : undefined,
                    y1: random() < 0.9 ? y1 : undefined,
                    y2: random() < 0.9 ? y1 + 1 + int(height) : undefined,
                },
            });
            depth++;
        } else if (r < 0.25 && depth > 0) {
            ops.push({ kind: "unclip" });
            depth--;
        } else {
            ops.push({
                kind: "write",
                x: int(width + 8) - 4,
                y: int(height + 4) - 2,
                text: WORDS[int(WORDS.length)]!,
                transform: random() < 0.1,
            });
        }
    }
    while (depth-- > 0) ops.push({ kind: "unclip" });
    return ops;
}

function render(Output: OutputClass, ops: Op[], width: number, height: number): { output: string; height: number } {
    const output = new Output({ width, height });
    for (const op of ops) {
        if (op.kind === "clip") output.clip(op.clip);
        else if (op.kind === "unclip") output.unclip();
        else {
            output.write(op.x, op.y, op.text, {
                transformers: op.transform ? [(s, i) => `${ESC}[7m${s}${ESC}[27m${i}`] : [],
            });
        }
    }
    return output.get();
}

describe("patched Ink output.js", () => {
    test("renders exactly what the stock file renders, over many frames", async () => {
        const [Stock, Patched] = await Promise.all([load("output.stock.js"), load("output.js")]);
        for (const seed of [1, 2, 3, 4, 5, 6]) {
            const random = rng(seed);
            const width = 30 + Math.floor(random() * 50);
            const height = 8 + Math.floor(random() * 14);
            let ops = makeFrame(random, width, height);
            for (let frame = 0; frame < 25; frame++) {
                // Mostly the same frame as before with a few changes (what a keystroke does), sometimes a new one.
                if (random() < 0.15) ops = makeFrame(random, width, height);
                else if (random() < 0.7) {
                    ops = ops.slice();
                    for (let i = 0; i < 3; i++) {
                        const at = Math.floor(random() * ops.length);
                        const op = ops[at]!;
                        if (op.kind === "write") ops[at] = { ...op, text: WORDS[Math.floor(random() * WORDS.length)]! };
                    }
                }
                const expected = render(Stock, ops, width, height);
                const actual = render(Patched, ops, width, height);
                expect(actual, `seed ${seed}, frame ${frame}`).toEqual(expected);
            }
        }
    });

    test("renders the same while the caches rotate on almost every entry", async () => {
        const [Stock, Patched, patch] = await Promise.all([
            load("output.stock.js"),
            load("output.js"),
            importPatch("output.js"),
        ]);
        const setBudget = patch["setCacheBudgetForTests"] as (bytes: number) => void;
        try {
            for (const budget of [1, 600, 5_000]) {
                setBudget(budget);
                const random = rng(budget);
                const width = 40 + Math.floor(random() * 30);
                const height = 10 + Math.floor(random() * 8);
                let ops = makeFrame(random, width, height);
                for (let frame = 0; frame < 15; frame++) {
                    if (random() < 0.3) ops = makeFrame(random, width, height);
                    expect(render(Patched, ops, width, height), `budget ${budget}, frame ${frame}`).toEqual(
                        render(Stock, ops, width, height)
                    );
                }
            }
        } finally {
            setBudget(40 * 1024 * 1024);
        }
    });

    test("a resize between frames does not leak rows of the old size", async () => {
        const [Stock, Patched] = await Promise.all([load("output.stock.js"), load("output.js")]);
        const random = rng(99);
        for (const [width, height] of [
            [40, 10],
            [60, 12],
            [40, 10],
            [20, 5],
            [40, 10],
        ] as const) {
            const ops = makeFrame(random, width, height);
            expect(render(Patched, ops, width, height)).toEqual(render(Stock, ops, width, height));
            expect(render(Patched, ops, width, height)).toEqual(render(Stock, ops, width, height));
        }
    });

    test("an empty or degenerate size renders like the stock file", async () => {
        const [Stock, Patched] = await Promise.all([load("output.stock.js"), load("output.js")]);
        for (const [width, height] of [
            [0, 0],
            [5, 0],
            [0, 3],
            [4.5, 2],
        ] as const) {
            const ops: Op[] = [{ kind: "write", x: 0, y: 0, text: "abc", transform: false }];
            expect(render(Patched, ops, width, height)).toEqual(render(Stock, ops, width, height));
        }
    });

    test("widestLine (used by the patched render-node-to-output.js) agrees with the widest-line package", async () => {
        const { widestLine } = (await importPatch("output.js")) as { widestLine: (text: string) => number };
        const stock = (await import("widest-line")).default as (text: string) => number;
        const random = rng(7);
        for (let i = 0; i < 300; i++) {
            const parts: string[] = [];
            for (let n = 1 + Math.floor(random() * 4); n > 0; n--)
                parts.push(WORDS[Math.floor(random() * WORDS.length)]!);
            const text = parts.join(random() < 0.5 ? "\n" : " ");
            expect(widestLine(text), JSON.stringify(text)).toBe(stock(text));
            expect(widestLine(text)).toBe(stock(text)); // second call: from the cache
        }
        expect(widestLine("")).toBe(stock(""));
    });

    test("the patched render-node-to-output.js differs from the stock one only in where widestLine comes from", async () => {
        const fs = await import("node:fs");
        const read = (file: string) => fs.readFileSync(path.resolve(__dirname, "../../patches/ink", file), "utf-8");
        const body = (text: string) =>
            text
                .split("\n")
                .filter(
                    (line) =>
                        !line.startsWith("//") &&
                        !line.includes("import widestLine") &&
                        !line.includes("import { widestLine }")
                );
        expect(body(read("render-node-to-output.js"))).toEqual(body(read("render-node-to-output.stock.js")));
    });
});
