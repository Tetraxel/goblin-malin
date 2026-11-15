import { describe, expect, test, vi } from "vitest";
import { validateJsonSchema, type JsonSchema } from "#base/agent/jsonSchema";
import { TaskLocks } from "#base/task/taskLock";
import { AgentTurn } from "#base/agent/agentTurn";
import { AgentJournal } from "#base/agent/journal";
import { AgentToolRegistry, describeProblem } from "#base/agent/agentToolRegistry";
import { AgentToolError, defineAgentTool } from "#base/agent/agentTool";
import {
    catalogueRows,
    renderCatalogueJson,
    renderCatalogueMarkdown,
    renderCatalogueText,
} from "#base/agent/catalogue";
import { registerAgentCleanup, runAgentCleanups } from "#base/agent/cleanup";

describe("validateJsonSchema", () => {
    const schema: JsonSchema = {
        type: "object",
        additionalProperties: false,
        required: ["taskId", "revision"],
        properties: {
            taskId: { type: "string", minLength: 1, maxLength: 5 },
            revision: { type: "integer", minimum: 0 },
            tags: { type: "array", items: { type: "string", enum: ["a", "b"] }, maxItems: 2 },
            nested: { type: "object", properties: { on: { type: "boolean" } } },
        },
    };

    test("accepts a valid input", () => {
        expect(validateJsonSchema(schema, { taskId: "t1", revision: 3, tags: ["a"], nested: { on: true } })).toEqual(
            []
        );
    });

    test("says which field is wrong and why", () => {
        const errors = validateJsonSchema(schema, { taskId: "", revision: 1.5, tags: ["a", "c", "a"], extra: 1 });
        expect(errors).toEqual(
            expect.arrayContaining([
                expect.stringContaining("input.taskId must be at least 1"),
                expect.stringContaining("input.revision must be an integer"),
                expect.stringContaining('input.tags[1] must be one of: "a", "b"'),
                expect.stringContaining("input.tags must have at most 2"),
                expect.stringContaining("input.extra is not an accepted field"),
            ])
        );
    });

    test("a missing required field and a wrong type are refused", () => {
        expect(validateJsonSchema(schema, { taskId: "t" })).toEqual(["input.revision is required"]);
        expect(validateJsonSchema(schema, "nope")).toEqual(["input must be an object"]);
        expect(validateJsonSchema(schema, { taskId: 5, revision: "1" })).toHaveLength(2);
        expect(validateJsonSchema(schema, { taskId: "t", revision: NaN })).toHaveLength(1);
    });

    test("a name every object inherits is not an accepted field either", () => {
        const input = JSON.parse('{"taskId":"t","revision":1,"constructor":{"x":1},"toString":2,"__proto__":{"y":1}}');
        expect(validateJsonSchema(schema, input)).toEqual([
            "input.constructor is not an accepted field",
            "input.toString is not an accepted field",
            "input.__proto__ is not an accepted field",
        ]);
        // ...and an inherited name does not satisfy a required field.
        const inheriting: JsonSchema = { type: "object", required: ["toString"] };
        expect(validateJsonSchema(inheriting, {})).toEqual(["input.toString is required"]);
    });
});

describe("TaskLocks", () => {
    test("two leases of the same holder on a task share it: it is free only once both are released", () => {
        const locks = new TaskLocks();
        const first = locks.acquire(["a"], "agent");
        const second = locks.acquire(["a", "b"], "agent");
        if (!first.ok || !second.ok) throw new Error("both leases should be granted");
        // The first call ends while the second (a parallel call of the same turn) still works on the task.
        first.lease.release();
        expect(locks.isLocked("a", "user")).toBe(true);
        expect(locks.isLocked("b", "user")).toBe(true);
        second.lease.release();
        expect(locks.isLocked("a")).toBe(false);
        expect(locks.isLocked("b")).toBe(false);
    });

    test("a lease holds the tasks until released, and release is safe twice", () => {
        const locks = new TaskLocks();
        const got = locks.acquire(["a", "b"], "agent");
        expect(got.ok).toBe(true);
        if (!got.ok) return;
        expect(locks.isLocked("a")).toBe(true);
        expect(locks.heldBy("b")).toBe("agent");
        // The holder itself is not locked out.
        expect(locks.isLocked("a", "agent")).toBe(false);
        expect(locks.isLocked("a", "user")).toBe(true);
        got.lease.release();
        got.lease.release();
        expect(locks.isLocked("a")).toBe(false);
    });

    test("all or nothing: one held task refuses the whole set", () => {
        const locks = new TaskLocks();
        const user = locks.acquire(["b"], "user");
        expect(user.ok).toBe(true);
        const agent = locks.acquire(["a", "b"], "agent");
        expect(agent).toEqual({ ok: false, heldBy: { b: "user" } });
        expect(locks.isLocked("a")).toBe(false);
    });

    test("a lease nobody released expires, so a task is never stuck", () => {
        let now = 1000;
        const locks = new TaskLocks(() => now);
        locks.acquire(["a"], "agent", { ttlMs: 500 });
        now += 499;
        expect(locks.isLocked("a")).toBe(true);
        now += 2;
        expect(locks.isLocked("a")).toBe(false);
    });

    test("tells listeners when a lock runs out by itself, so a row stops showing it as held", async () => {
        vi.useFakeTimers();
        try {
            const locks = new TaskLocks();
            let calls = 0;
            locks.subscribe(() => calls++);
            locks.acquire(["a"], "agent", { ttlMs: 500 });
            expect(calls).toBe(1);
            await vi.advanceTimersByTimeAsync(600);
            expect(calls).toBe(2);
            expect(locks.isLocked("a")).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    test("renew pushes the expiry back; an old lease cannot release a newer holder's lock", () => {
        let now = 0;
        const locks = new TaskLocks(() => now);
        const first = locks.acquire(["a"], "agent", { ttlMs: 100 });
        if (!first.ok) throw new Error("expected a lease");
        now = 90;
        first.lease.renew(100);
        now = 150;
        expect(locks.isLocked("a")).toBe(true);
        now = 300; // expired
        const second = locks.acquire(["a"], "user");
        expect(second.ok).toBe(true);
        first.lease.release();
        expect(locks.heldBy("a")).toBe("user");
    });

    test("tells listeners about changes, and clear() frees everything", () => {
        const locks = new TaskLocks();
        let calls = 0;
        locks.subscribe(() => calls++);
        const got = locks.acquire(["a"], "agent");
        expect(calls).toBe(1);
        locks.clear();
        expect(calls).toBe(2);
        expect(locks.isLocked("a")).toBe(false);
        if (got.ok) got.lease.release();
        expect(calls).toBe(2);
    });
});

describe("AgentTurn", () => {
    test("every lease is given back when the turn ends, however it ends", () => {
        const locks = new TaskLocks();
        const turn = new AgentTurn(locks);
        const got = turn.acquire(["a", "b"]);
        expect("lease" in got).toBe(true);
        expect(locks.isLocked("a")).toBe(true);
        turn.end();
        expect(locks.isLocked("a")).toBe(false);
        expect(turn.signal.aborted).toBe(true);
        expect(turn.acquire(["c"])).toEqual({ heldBy: {} });
    });

    test("a task someone else holds cannot be taken", () => {
        const locks = new TaskLocks();
        locks.acquire(["a"], "user");
        const turn = new AgentTurn(locks);
        expect(turn.acquire(["a"])).toEqual({ heldBy: { a: "user" } });
    });

    test("the mutation budget counts per task touched, not per call", () => {
        const turn = new AgentTurn(new TaskLocks(), { perTask: 2, tasks: 3 });
        // A bulk call over three tasks counts once for each.
        expect(turn.spend(["a", "b", "c"])).toBeUndefined();
        expect(turn.spend(["a"])).toBeUndefined();
        expect(turn.spend(["a"])).toMatch(/already been changed 2 times/);
        expect(turn.spend(["d"])).toMatch(/already changed 3 tasks/);
        expect(turn.touched.get("a")).toBe(2);
    });

    test("a change can be checked first and counted after it went through", () => {
        const turn = new AgentTurn(new TaskLocks(), { perTask: 2, tasks: 3 });
        // Checking never uses the budget up.
        for (let i = 0; i < 5; i++) expect(turn.checkBudget(["a"])).toBeUndefined();
        expect(turn.touched.get("a")).toBeUndefined();
        turn.count(["a"]);
        turn.count(["a"]);
        expect(turn.checkBudget(["a"])).toMatch(/already been changed 2 times/);
        expect(turn.checkBudget(["b"])).toBeUndefined();
    });

    test("a change can be checked first and counted after it went through", () => {
        const turn = new AgentTurn(new TaskLocks(), { perTask: 2, tasks: 3 });
        // Checking never uses the budget up.
        for (let i = 0; i < 5; i++) expect(turn.checkBudget(["a"])).toBeUndefined();
        expect(turn.touched.get("a")).toBeUndefined();
        turn.count(["a"]);
        turn.count(["a"]);
        expect(turn.checkBudget(["a"])).toMatch(/already been changed 2 times/);
        expect(turn.checkBudget(["b"])).toBeUndefined();
    });

    test("progress goes to its listener and a broken listener never stops the tool", () => {
        const turn = new AgentTurn(new TaskLocks());
        const seen: string[] = [];
        turn.onProgress = (t) => seen.push(t);
        turn.progress("one");
        turn.onProgress = () => {
            throw new Error("boom");
        };
        expect(() => turn.progress("two")).not.toThrow();
        expect(seen).toEqual(["one"]);
    });
});

describe("AgentJournal", () => {
    test("undo puts things back, newest first, and only while the task is as the agent left it", async () => {
        const revisions = new Map([["a", 5]]);
        const journal = new AgentJournal((id) => revisions.get(id));
        let value = "after";
        journal.record({
            tool: "t",
            label: "change a",
            checks: [{ taskId: "a", revisionAfter: 5 }],
            restore: () => void (value = "before"),
        });

        // The user edited the task since: undoing would erase that.
        revisions.set("a", 6);
        const refused = await journal.undoLast();
        expect(refused).toMatchObject({ done: false, reason: "changed", taskId: "a" });
        expect(value).toBe("after");
        expect(journal.list()).toHaveLength(1);

        revisions.set("a", 5);
        expect(await journal.undoLast()).toMatchObject({ done: true });
        expect(value).toBe("before");
        expect(await journal.undoLast()).toEqual({ done: false, reason: "nothing" });
    });

    test("a batch is one action: every task must be unchanged", async () => {
        const revisions = new Map([
            ["a", 1],
            ["b", 2],
        ]);
        const journal = new AgentJournal((id) => revisions.get(id));
        let restored = false;
        journal.record({
            tool: "apply_batch",
            label: "batch",
            checks: [
                { taskId: "a", revisionAfter: 1 },
                { taskId: "b", revisionAfter: 2 },
            ],
            restore: () => void (restored = true),
        });
        revisions.set("b", 3);
        expect(await journal.undoLast()).toMatchObject({ done: false, reason: "changed", taskId: "b" });
        expect(restored).toBe(false);
    });

    test("an entry whose task is gone is dropped (nothing left to put back)", async () => {
        const journal = new AgentJournal(() => undefined);
        journal.record({ tool: "t", label: "x", checks: [{ taskId: "a", revisionAfter: 1 }], restore: () => {} });
        expect(await journal.undoLast()).toMatchObject({ done: false, reason: "gone" });
        expect(journal.list()).toHaveLength(0);
    });
});

const ok = () =>
    defineAgentTool({
        name: "do_it",
        summary: "Does it.",
        kind: "read",
        locks: "none",
        undoable: false,
        input: { type: "object", required: ["n"], properties: { n: { type: "integer" } } },
        run: ({ n }: { n: number }) => ({ doubled: n * 2 }),
    });

describe("AgentToolRegistry", () => {
    test("a tool without a summary, an input schema, a kind or a lock declaration does not register", () => {
        const base = ok();
        expect(describeProblem(base)).toBeUndefined();
        expect(describeProblem({ ...base, summary: " " })).toMatch(/no summary/);
        expect(describeProblem({ ...base, kind: undefined as never })).toMatch(/no kind/);
        expect(describeProblem({ ...base, input: undefined as never })).toMatch(/no input schema/);
        expect(describeProblem({ ...base, locks: undefined as never })).toMatch(/what it locks/);
        expect(describeProblem({ ...base, name: "Bad-Name" })).toMatch(/snake_case/);
        expect(describeProblem({ ...base, locks: "task" })).toMatch(/taskId/);
        expect(describeProblem({ ...base, undoable: true })).toMatch(/read tool has nothing to undo/);
        const registry = new AgentToolRegistry();
        expect(() => registry.register({ ...base, summary: "" })).toThrow(/cannot register/);
        registry.register(base);
        expect(() => registry.register(base)).toThrow(/already registered/);
    });

    test("every call is validated against the tool's own schema before it runs", async () => {
        const registry = new AgentToolRegistry().register(ok());
        const turn = new AgentTurn(new TaskLocks());
        expect(await registry.execute("do_it", { n: 21 }, turn)).toEqual({ isError: false, text: '{"doubled":42}' });
        const bad = await registry.execute("do_it", { n: "x" }, turn);
        expect(bad.isError).toBe(true);
        expect(bad.text).toMatch(/Invalid input for do_it: input.n must be a number/);
        expect((await registry.execute("nope", {}, turn)).text).toMatch(/Unknown tool/);
    });

    test("an error the tool raises on purpose reaches the model as text; a bug as a short line", async () => {
        const registry = new AgentToolRegistry()
            .register(
                defineAgentTool({
                    name: "refuses",
                    summary: "x",
                    kind: "read",
                    locks: "none",
                    undoable: false,
                    input: { type: "object" },
                    run: () => {
                        throw new AgentToolError("the task changed", "stale");
                    },
                })
            )
            .register(
                defineAgentTool({
                    name: "crashes",
                    summary: "x",
                    kind: "read",
                    locks: "none",
                    undoable: false,
                    input: { type: "object" },
                    run: () => {
                        throw new TypeError("cannot read x");
                    },
                })
            );
        const turn = new AgentTurn(new TaskLocks());
        expect(await registry.execute("refuses", {}, turn)).toEqual({ isError: true, text: "the task changed" });
        expect(await registry.execute("crashes", {}, turn)).toEqual({
            isError: true,
            text: "crashes failed: cannot read x",
        });
    });

    test('a tool that locks "task" holds the task for the call and gives it back, also on error', async () => {
        const locks = new TaskLocks();
        let heldInside: boolean | undefined;
        const registry = new AgentToolRegistry().register(
            defineAgentTool({
                name: "edit",
                summary: "x",
                kind: "write",
                locks: "task",
                undoable: false,
                input: { type: "object", required: ["taskId"], properties: { taskId: { type: "string" } } },
                run: (input: { taskId: string }) => {
                    heldInside = locks.heldBy(input.taskId) === "agent";
                    throw new AgentToolError("nope");
                },
            })
        );
        const turn = new AgentTurn(locks);
        const result = await registry.execute("edit", { taskId: "t1" }, turn);
        expect(result.isError).toBe(true);
        expect(heldInside).toBe(true);
        expect(locks.isLocked("t1")).toBe(false);

        // Someone else is editing it: the tool never runs.
        locks.acquire(["t1"], "user");
        heldInside = undefined;
        expect((await registry.execute("edit", { taskId: "t1" }, turn)).text).toMatch(/being edited by someone else/);
        expect(heldInside).toBeUndefined();
    });

    test("nothing runs on a turn that was stopped, and a huge answer is cut", async () => {
        const registry = new AgentToolRegistry().register(
            defineAgentTool({
                name: "big",
                summary: "x",
                kind: "read",
                locks: "none",
                undoable: false,
                input: { type: "object" },
                run: () => "x".repeat(100_000),
            })
        );
        const turn = new AgentTurn(new TaskLocks());
        const big = await registry.execute("big", {}, turn);
        expect(big.text.length).toBeLessThan(31_000);
        expect(big.text).toMatch(/cut at 30000 characters/);
        turn.stop();
        expect((await registry.execute("big", {}, turn)).text).toMatch(/stopped/);
    });
});

describe("catalogue", () => {
    const tool = defineAgentTool({
        name: "do_it",
        summary: "Does it | really.",
        kind: "confirm",
        locks: "tasks",
        undoable: false,
        input: { type: "object", required: ["a"], properties: { a: { type: "string" }, b: { type: "string" } } },
        example: { a: "x" },
        run: () => 1,
    });

    test("one row per tool, with optional inputs marked and confirm tools flagged", () => {
        const rows = catalogueRows([tool, ok()]);
        expect(rows[0]).toMatchObject({
            name: "do_it",
            kind: "confirm",
            locks: "tasks",
            confirms: true,
            inputs: "a, b?",
        });
        expect(catalogueRows([tool, ok()], { kind: "read" }).map((r) => r.name)).toEqual(["do_it"]);
        expect(catalogueRows([tool, ok()], { kind: "write" })).toEqual([]);
    });

    test("renders text, markdown (a | in a cell is escaped) and json", () => {
        const rows = catalogueRows([tool]);
        expect(renderCatalogueText(rows).split("\n")[0]).toMatch(/^Tool\s+Kind\s+Locks/);
        expect(renderCatalogueMarkdown(rows)).toContain("`do_it`");
        expect(renderCatalogueMarkdown(rows)).toContain("Does it \\| really.");
        expect(JSON.parse(renderCatalogueJson([tool]))[0]).toMatchObject({ name: "do_it", example: { a: "x" } });
    });
});

describe("agent cleanups", () => {
    test("everything registered is stopped, once, and a failing stop does not block the others", async () => {
        const stopped: string[] = [];
        registerAgentCleanup(() => void stopped.push("a"));
        registerAgentCleanup(() => {
            throw new Error("boom");
        });
        const forget = registerAgentCleanup(() => void stopped.push("forgotten"));
        forget();
        await runAgentCleanups(500);
        expect(stopped).toEqual(["a"]);
        await runAgentCleanups(500);
        expect(stopped).toEqual(["a"]);
    });
});
