import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { useFileExists } from "#hooks/useFileExists";
import { mountHook, tick } from "./helpers/mountHook";

describe("useFileExists — a saved file that is not on disk is noticed", () => {
    let dir: string;
    beforeAll(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-exists-"));
    });
    afterAll(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test("unknown for no path, then true for a file and false for one that is gone", async () => {
        const present = path.join(dir, "here.flac");
        fs.writeFileSync(present, "x");
        const hook = mountHook<string | undefined, boolean | undefined>((p) => useFileExists(p), undefined);
        expect(hook.current()).toBeUndefined();

        hook.rerender(present);
        await tick();
        expect(hook.current()).toBe(true);

        // Deleted while the app is closed or open: the answer for that path is "no".
        hook.rerender(path.join(dir, "gone.flac"));
        await tick();
        expect(hook.current()).toBe(false);
    });

    test("an answer for another path is never taken for this one", async () => {
        const present = path.join(dir, "a.flac");
        fs.writeFileSync(present, "x");
        const hook = mountHook<string | undefined, boolean | undefined>((p) => useFileExists(p), present);
        await tick();
        expect(hook.current()).toBe(true);
        hook.rerender(path.join(dir, "b.flac"));
        // Rendered again before the new look is done: unknown, not the old file's "yes".
        expect(hook.current()).toBeUndefined();
    });
});
