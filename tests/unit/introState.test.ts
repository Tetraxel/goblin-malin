import { afterEach, describe, expect, it, vi } from "vitest";
import { introState } from "../../src/utils/introState";

afterEach(() => introState.reset());

describe("introState", () => {
    it("is open until the intro closes, then tells the listeners", () => {
        introState.reset(true);
        const listener = vi.fn();
        introState.subscribe(listener);

        expect(introState.isOpen()).toBe(true);
        introState.close();

        expect(introState.isOpen()).toBe(false);
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it("does not notify again once it is closed", () => {
        introState.reset(false);
        const listener = vi.fn();
        introState.subscribe(listener);

        introState.close();

        expect(listener).not.toHaveBeenCalled();
    });

    it("stops notifying a listener that unsubscribed", () => {
        introState.reset(true);
        const listener = vi.fn();
        introState.subscribe(listener)();

        introState.close();

        expect(listener).not.toHaveBeenCalled();
    });
});
