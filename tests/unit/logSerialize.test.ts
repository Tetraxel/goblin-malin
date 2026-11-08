import { describe, expect, test } from "vitest";
import { toLoggable } from "#base/logger/serialize";

class FakeTask {
    constructor(public id: string) {}
    getAttributes() {
        return { huge: "x".repeat(10_000) };
    }
    getLogLabel() {
        return "spotify:track:abc";
    }
}

describe("toLoggable (DATA-10)", () => {
    test("an Error keeps its name, message and stack instead of serializing to {}", () => {
        expect(JSON.stringify(new Error("x"))).toBe("{}");
        const out = JSON.parse(JSON.stringify(toLoggable({ error: new Error("boom") }))) as {
            error: { name: string; message: string; stack: string };
        };
        expect(out.error.name).toBe("Error");
        expect(out.error.message).toBe("boom");
        expect(out.error.stack).toContain("boom");
    });

    test("keeps the cause and extra fields of an Error", () => {
        const error = Object.assign(new Error("outer", { cause: new Error("inner") }), { code: "ENOENT" });
        const out = toLoggable(error) as { cause: { message: string }; code: string };
        expect(out.cause.message).toBe("inner");
        expect(out.code).toBe("ENOENT");
    });

    test("a Task becomes a small reference, at the top level and nested", () => {
        const task = new FakeTask("t1");
        expect(toLoggable(task)).toEqual({ taskId: "t1", label: "spotify:track:abc" });
        const nested = toLoggable({ details: { task } });
        expect(JSON.stringify(nested).length).toBeLessThan(200);
    });

    test("survives cycles and cuts very deep objects", () => {
        const a: Record<string, unknown> = { name: "a" };
        a.self = a;
        expect(() => JSON.stringify(toLoggable(a))).not.toThrow();
        expect((toLoggable(a) as { self: unknown }).self).toBe("[Circular]");

        let deep: Record<string, unknown> = {};
        const root = deep;
        for (let i = 0; i < 20; i++) deep = (deep.next = {});
        expect(JSON.stringify(toLoggable(root))).toContain("[Object]");
    });

    test("the same object twice side by side is not a cycle", () => {
        const shared = { a: 1 };
        expect(toLoggable({ x: shared, y: shared })).toEqual({ x: { a: 1 }, y: { a: 1 } });
    });

    test("passes plain values, Dates, Maps and Sets through in a JSON-friendly form", () => {
        expect(toLoggable("s")).toBe("s");
        expect(toLoggable(null)).toBeNull();
        expect(toLoggable(new Date("2026-11-08T00:00:00Z"))).toBe("2026-11-08T00:00:00.000Z");
        expect(toLoggable(new Map([["k", 1]]))).toEqual({ k: 1 });
        expect(toLoggable(new Set([1, 2]))).toEqual([1, 2]);
    });
});
