import { describe, expect, test } from "vitest";
import { inkTransport } from "#base/logger/ink-transport";
import { globalLogger } from "#base/logger/logger";

// A message with a format token (`%s`, as every React dev warning has) made winston drop the entry's metadata: no id,
// no time, so the log panel gave every such row the same key, React warned about it, and the warning was logged with
// a `%s` again, without end.
describe("logger and format tokens", () => {
    test.each(["Encountered two children with the same key, `%s`.", "100% sure, %d %j", "plain"])(
        "keeps the id, time and level of %j",
        (message) => {
            globalLogger.error(message);
            const entry = inkTransport.getLogs().at(-1) as unknown as Record<string, unknown>;
            expect(entry.message).toBe(message);
            expect(typeof entry.id).toBe("string");
            expect(entry.timestamp).toBeInstanceOf(Date);
            expect(entry.level).toBe("ERROR");
        }
    );
});
