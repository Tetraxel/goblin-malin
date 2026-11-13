import { describe, expect, test, vi } from "vitest";
import { serializeSessionsFile } from "#sessions/serialize";
import type { SessionsFile, StoredSession } from "#sessions/types";

const task = (id: string, extra: Record<string, unknown> = {}) =>
    ({
        id,
        initialInput: `https://example.com/${id}`,
        attributes: { kind: "track", state: "finished", note: 'é "quoted" \n line', ...extra },
        status: { type: "success", message: "done", startTime: new Date("2026-01-01T00:00:00.000Z") },
        prompt: null,
    }) as never;

const session = (id: string, taskCount: number, extra: Partial<StoredSession> = {}): StoredSession => ({
    id,
    name: `Session ${id}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    tasks: Array.from({ length: taskCount }, (_, i) => task(`${id}-${i}`)),
    ...extra,
});

const file = (sessions: StoredSession[]): SessionsFile => ({
    version: 1,
    lastSessionId: sessions[0]?.id ?? null,
    sessions,
});

describe("serializeSessionsFile", () => {
    test("reads back exactly like JSON.stringify would have", () => {
        const withArchive = session("b", 2, {
            lastUsedAt: "2026-01-03T00:00:00.000Z",
            renamed: true,
            archived: [{ archivedAt: "2026-01-02T00:00:00.000Z", task: task("old") }],
        });
        const input = file([session("a", 3), withArchive, session("empty", 0)]);
        expect(JSON.parse(serializeSessionsFile(input))).toEqual(JSON.parse(JSON.stringify(input)));
    });

    test("keeps members it knows nothing about (a file saved by a newer version)", () => {
        const stored = { ...session("a", 1), futureField: [1, 2] } as StoredSession;
        const input = { ...file([stored]), futureThing: { a: 1 } } as SessionsFile;
        expect(JSON.parse(serializeSessionsFile(input))).toEqual(JSON.parse(JSON.stringify(input)));
    });

    test("an empty file and a session without tasks are valid JSON", () => {
        expect(JSON.parse(serializeSessionsFile(file([])))).toEqual({ version: 1, lastSessionId: null, sessions: [] });
        const text = serializeSessionsFile(file([session("a", 0)]));
        expect(JSON.parse(text).sessions[0].tasks).toEqual([]);
    });

    test("a save stringifies only what is new: unchanged tasks and sessions are not serialised again", () => {
        const sessions = [session("a", 50), session("b", 50, { archived: [{ archivedAt: "x", task: task("old") }] })];
        const first = serializeSessionsFile(file(sessions));

        const spy = vi.spyOn(JSON, "stringify");
        try {
            // Same objects, one session replaced by a copy with one task changed (what a save of the open session does).
            const changed = task("a-7", { state: "downloading" });
            const reopened: StoredSession = {
                ...sessions[0]!,
                updatedAt: "2026-02-01T00:00:00.000Z",
                tasks: sessions[0]!.tasks.map((t, i) => (i === 7 ? changed : t)),
            };
            const second = serializeSessionsFile({ ...file([reopened, sessions[1]!]), lastSessionId: "b" });

            // The file envelope, the new session's envelope and the one new task: nothing per unchanged task.
            expect(spy.mock.calls.length).toBeLessThanOrEqual(3);
            expect(JSON.parse(second).sessions[0].tasks[7].attributes.state).toBe("downloading");
            expect(JSON.parse(second).sessions[0].tasks[8].id).toBe("a-8");
            expect(JSON.parse(second).lastSessionId).toBe("b");
            expect(second).not.toBe(first);
        } finally {
            spy.mockRestore();
        }
    });

    test("is linear: serialising an unchanged 5,000-task session again does no per-task work", () => {
        const big = file([session("big", 5000)]);
        serializeSessionsFile(big);
        const spy = vi.spyOn(JSON, "stringify");
        try {
            serializeSessionsFile({ ...big, lastSessionId: null });
            expect(spy.mock.calls.length).toBeLessThanOrEqual(1);
        } finally {
            spy.mockRestore();
        }
    });
});
