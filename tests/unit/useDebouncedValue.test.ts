import { describe, expect, test } from "vitest";
import { useDebouncedValue } from "../../src/hooks/useDebouncedValue";
import { mountHook, tick } from "./helpers/mountHook";

type Props = { value: string; delayMs: number };
const mount = (value: string, delayMs = 60) =>
    mountHook(({ value, delayMs }: Props) => useDebouncedValue(value, delayMs), { value, delayMs });

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
});
