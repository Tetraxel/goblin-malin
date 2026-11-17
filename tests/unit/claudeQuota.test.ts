import { describe, expect, it, vi } from "vitest";
import {
    parseAgentStreamLine,
    parseQuotaWindows,
} from "../../src/flows/musicDownloadFlow/services/apis/claude-agent-client";
import { ClaudeQuotaStore, formatResetTime, quotaRows } from "../../src/flows/musicDownloadFlow/agent/claudeQuota";

const EVENT = {
    type: "rate_limit_event",
    rate_limit_info: {
        status: "allowed",
        resetsAt: 1794875400,
        rateLimitType: "five_hour",
        unifiedWindows: {
            five_hour: { utilization: 0.41, resetsAt: 1794875400 },
            seven_day: { utilization: 0.25, resetsAt: 1795356000 },
        },
    },
};

describe("plan usage from the CLI", () => {
    it("reads both windows of a rate_limit_event, resets in milliseconds", () => {
        const events = parseAgentStreamLine(JSON.stringify(EVENT));
        expect(events).toEqual([
            {
                type: "quota",
                windows: {
                    fiveHour: { utilization: 0.41, resetsAt: 1794875400_000 },
                    sevenDay: { utilization: 0.25, resetsAt: 1795356000_000 },
                },
            },
        ]);
    });

    it("ignores an event with no usable window", () => {
        expect(parseAgentStreamLine(JSON.stringify({ type: "rate_limit_event", rate_limit_info: {} }))).toEqual([]);
        expect(parseQuotaWindows({ unifiedWindows: { five_hour: { utilization: "x", resetsAt: 1 } } })).toBeUndefined();
    });

    it("reads a percentage as a share and clamps", () => {
        const w = parseQuotaWindows({ unifiedWindows: { five_hour: { utilization: 41, resetsAt: 10 } } });
        expect(w?.fiveHour?.utilization).toBeCloseTo(0.41);
        const full = parseQuotaWindows({ unifiedWindows: { five_hour: { utilization: 250, resetsAt: 10 } } });
        expect(full?.fiveHour?.utilization).toBe(1);
    });
});

describe("ClaudeQuotaStore", () => {
    it("keeps the window a report leaves out, and saves", () => {
        const save = vi.fn().mockResolvedValue(undefined);
        const store = new ClaudeQuotaStore({ load: async () => undefined, save });
        store.update(
            { fiveHour: { utilization: 0.1, resetsAt: 1000 }, sevenDay: { utilization: 0.2, resetsAt: 2000 } },
            5
        );
        store.update({ fiveHour: { utilization: 0.3, resetsAt: 1000 } }, 6);
        expect(store.getSnapshot().windows.fiveHour?.utilization).toBe(0.3);
        expect(store.getSnapshot().windows.sevenDay?.utilization).toBe(0.2);
        expect(save).toHaveBeenCalledTimes(2);
    });

    it("does not notify when the figures are the same", () => {
        const store = new ClaudeQuotaStore();
        const listener = vi.fn();
        store.subscribe(listener);
        const w = { fiveHour: { utilization: 0.1, resetsAt: 1000 } };
        store.update(w);
        store.update({ ...w });
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it("loads the last launch's figures, but not over this launch's", async () => {
        const saved = { windows: { fiveHour: { utilization: 0.9, resetsAt: 1 } }, at: 7 };
        const store = new ClaudeQuotaStore({ load: async () => saved, save: async () => undefined });
        await store.ensureLoaded();
        expect(store.getSnapshot()).toEqual(saved);

        const fresh = new ClaudeQuotaStore({ load: async () => saved, save: async () => undefined });
        fresh.update({ fiveHour: { utilization: 0.2, resetsAt: 5 } }, 9);
        await fresh.ensureLoaded();
        expect(fresh.getSnapshot().windows.fiveHour?.utilization).toBe(0.2);
    });
});

describe("what the panel shows", () => {
    it("shows a window that has reset as empty", () => {
        const rows = quotaRows(
            {
                windows: {
                    fiveHour: { utilization: 0.8, resetsAt: 1000 },
                    sevenDay: { utilization: 0.5, resetsAt: 9000 },
                },
                at: 1,
            },
            2000
        );
        expect(rows).toEqual([
            { label: "5h", share: 0, reset: true, resetsAt: 1000, text: "reset" },
            { label: "7d", share: 0.5, reset: false, resetsAt: 9000, text: expect.stringMatching(/^resets /) },
        ]);
    });

    it("writes a time today as a clock and another day with its weekday", () => {
        const now = new Date(2026, 10, 17, 9, 0).getTime();
        expect(formatResetTime(new Date(2026, 10, 17, 14, 30).getTime(), now)).toBe("14:30");
        expect(formatResetTime(new Date(2026, 10, 20, 10, 0).getTime(), now)).toBe("Fri 10:00");
    });
});
