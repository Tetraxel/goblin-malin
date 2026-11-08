import { describe, expect, test, vi, beforeEach } from "vitest";

const spawnMock = vi.hoisted(() =>
    vi.fn(() => ({
        on: () => ({ unref: () => {} }),
        unref: () => {},
    })),
);
vi.mock("child_process", () => ({ spawn: spawnMock }));

import { openUrl } from "#utils/openUrl";
import { getUpdateArgv, getUpdateCommand } from "#updater/installSource";

describe("openUrl (SEC-01)", () => {
    beforeEach(() => spawnMock.mockClear());

    test("passes the URL as one argv entry, never through a shell", () => {
        expect(openUrl("https://example.com/a?b=1")).toBe(true);
        const [, args, opts] = spawnMock.mock.calls[0] as unknown as [string, string[], Record<string, unknown>];
        expect(args[args.length - 1]).toBe("https://example.com/a?b=1");
        expect(opts.shell).toBeUndefined();
    });

    test("a quote in the URL is percent-encoded, not left to break out of quoting", () => {
        openUrl('https://example.com/" & calc & "');
        const [, args] = spawnMock.mock.calls[0] as unknown as [string, string[]];
        expect(args[args.length - 1]).not.toContain('"');
    });

    test("rejects non-http(s) and unparsable input", () => {
        expect(openUrl("file:///C:/Windows/System32/calc.exe")).toBe(false);
        expect(openUrl("javascript:alert(1)")).toBe(false);
        expect(openUrl("not a url")).toBe(false);
        expect(spawnMock).not.toHaveBeenCalled();
    });
});

describe("getUpdateArgv (SEC-01)", () => {
    test("accepts plain semver", () => {
        expect(getUpdateArgv("1.2.3").args).toContain("goblin-malin@1.2.3");
        expect(getUpdateArgv("1.2.3-beta.1").args).toContain("goblin-malin@1.2.3-beta.1");
    });

    test("falls back to the unversioned package for anything that is not semver", () => {
        for (const bad of ["1.2.3 && calc", "1.2.3;rm -rf /", "$(whoami)", "1.2", "latest", ""]) {
            const { args } = getUpdateArgv(bad);
            expect(args[args.length - 1]).toBe("goblin-malin");
        }
        expect(getUpdateCommand("1.0.0; calc")).not.toMatch(/[;&$]/);
    });
});
