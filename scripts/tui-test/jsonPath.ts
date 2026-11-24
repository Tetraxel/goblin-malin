/**
 * The steps of a path: `a.b[0]` → `a`, `b`, `0`. A key that has dots or brackets in it is quoted:
 * `keybindings["sessionsModal.new"]` (a shortcut id is stored that way).
 */
export function pathParts(pathText: string): string[] {
    const parts: string[] = [];
    const re = /\[\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(-?\d+))\s*\]|([^.[\]]+)/g;
    for (const m of pathText.matchAll(re)) {
        const quoted = m[1] ?? m[2];
        parts.push(quoted !== undefined ? quoted.replace(/\\(.)/g, "$1") : (m[3] ?? m[4])!);
    }
    return parts;
}

/**
 * Reads a value out of parsed JSON by a path: `music.download.outputDir`, `sessions[0].tasks.length`,
 * `sessions.0.name`, `keybindings["sessionsModal.new"]`. A missing step gives `undefined`. Used by the harness's file
 * assertions (`assertJson`).
 */
export function getPath(root: unknown, pathText: string): unknown {
    const parts = pathParts(pathText);
    let value: unknown = root;
    for (const part of parts) {
        if (value === null || value === undefined) return undefined;
        if (Array.isArray(value) && /^-?\d+$/.test(part)) {
            const index = Number(part);
            value = value[index < 0 ? value.length + index : index];
        } else if (typeof value === "object") {
            value = (value as Record<string, unknown>)[part];
        } else if (part === "length" && typeof value === "string") {
            value = value.length;
        } else {
            return undefined;
        }
    }
    return value;
}

/** What a JSON check asks of the value at the path. */
export interface JsonExpectation {
    /** `true`: the path must exist; `false`: it must not. */
    exists?: boolean;
    /** Deep equality with this value. */
    equals?: unknown;
    /** A string that contains this text, or an array that has this (deeply equal) item. */
    contains?: unknown;
    /** A string that matches this regular expression source. */
    matches?: string;
    gt?: number;
    gte?: number;
    lt?: number;
    lte?: number;
    /** The length of the array or string. */
    length?: number;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Why the value does not meet the expectation, or "" when it does. */
export function checkJsonValue(value: unknown, expected: JsonExpectation): string {
    const problems: string[] = [];
    const show = (v: unknown): string => {
        const text = JSON.stringify(v);
        return text === undefined ? "undefined" : text.length > 120 ? text.slice(0, 117) + "…" : text;
    };
    if (expected.exists !== undefined && (value !== undefined) !== expected.exists) {
        problems.push(expected.exists ? "does not exist" : `exists (${show(value)})`);
    }
    if ("equals" in expected && !same(value, expected.equals)) {
        problems.push(`is ${show(value)}, wanted ${show(expected.equals)}`);
    }
    if ("contains" in expected) {
        const ok =
            typeof value === "string"
                ? typeof expected.contains === "string" && value.includes(expected.contains)
                : Array.isArray(value) && value.some((item) => same(item, expected.contains));
        if (!ok) problems.push(`${show(value)} does not contain ${show(expected.contains)}`);
    }
    if (expected.matches !== undefined && !(typeof value === "string" && new RegExp(expected.matches).test(value))) {
        problems.push(`${show(value)} does not match /${expected.matches}/`);
    }
    const numeric = typeof value === "number" ? value : undefined;
    for (const [key, test] of [
        ["gt", (v: number, w: number) => v > w],
        ["gte", (v: number, w: number) => v >= w],
        ["lt", (v: number, w: number) => v < w],
        ["lte", (v: number, w: number) => v <= w],
    ] as const) {
        const wanted = expected[key];
        if (wanted !== undefined && !(numeric !== undefined && test(numeric, wanted))) {
            problems.push(`${show(value)} is not ${key} ${wanted}`);
        }
    }
    if (expected.length !== undefined) {
        const length = Array.isArray(value) || typeof value === "string" ? value.length : undefined;
        if (length !== expected.length) problems.push(`length is ${length ?? "n/a"}, wanted ${expected.length}`);
    }
    return problems.join("; ");
}

/** The text without a leading byte-order mark. */
export const stripBom = (text: string): string => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
