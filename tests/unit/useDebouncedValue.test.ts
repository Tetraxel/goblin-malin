import { describe, expect, test } from "vitest";
import { useDebouncedValue } from "../../src/hooks/useDebouncedValue";
import { mountHook, tick } from "./helpers/mountHook";

type Props = { value: string; delayMs: number };
const mount = (value: string, delayMs = 60, leading = false) =>
    mountHook(({ value, delayMs }: Props) => useDebouncedValue(value, delayMs, { leading }), { value, delayMs });

describe("useDebouncedValue", () => {
    test("starts with the value it is given", () => {
        expect(mount("a").current()).toBe("a");
    });

    test("keeps the old value until the new one has been stable for the delay", async () => {
        const host = mount("a", 80);
        host.rerender({ value: "b", delayMs: 80 });
        await tick(20);
        expect(host.current()).toBe("a");
        await tick(120);
        expect(host.current()).toBe("b");
    });

    test("a value that keeps changing never settles; only the last one is published", async () => {
        const host = mount("a", 80);
        for (const value of ["b", "c", "d"]) {
            host.rerender({ value, delayMs: 80 });
            await tick(30); // shorter than the delay each time
            expect(host.current()).toBe("a");
        }
        await tick(150);
        expect(host.current()).toBe("d");
    });

    test("going back to the published value cancels the pending update", async () => {
        const host = mount("a", 60);
        host.rerender({ value: "b", delayMs: 60 });
        await tick(20);
        host.rerender({ value: "a", delayMs: 60 });
        await tick(120);
        expect(host.current()).toBe("a");
    });

    describe("leading", () => {
        test("an isolated change is published in the same render", () => {
            const host = mount("a", 80, true);
            host.rerender({ value: "b", delayMs: 80 });
            expect(host.current()).toBe("b");
        });

        test("a second isolated change, after a pause, is also immediate", async () => {
            const host = mount("a", 40, true);
            host.rerender({ value: "b", delayMs: 40 });
            await tick(120);
            host.rerender({ value: "c", delayMs: 40 });
            expect(host.current()).toBe("c");
        });

        test("changes faster than the delay wait for the trailing timer (a held key)", async () => {
            const host = mount("a", 80, true);
            host.rerender({ value: "b", delayMs: 80 }); // first of the burst: immediate
            expect(host.current()).toBe("b");
            for (const value of ["c", "d", "e"]) {
                await tick(20);
                host.rerender({ value, delayMs: 80 });
                expect(host.current()).toBe("b");
            }
            await tick(150);
            expect(host.current()).toBe("e");
        });

        test("a value that is back to the published one cancels the pending update", async () => {
            const host = mount("a", 60, true);
            host.rerender({ value: "b", delayMs: 60 });
            host.rerender({ value: "c", delayMs: 60 });
            host.rerender({ value: "b", delayMs: 60 });
            await tick(120);
            expect(host.current()).toBe("b");
        });
    });
});
