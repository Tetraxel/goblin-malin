import * as http from "http";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { fetchWithTimeout, TimeoutError, withTimeout, withTimeouts } from "#utils/timeout";

// A request that never answers must end the track's step, not hold one of the few metadata slots for minutes.

const never = () => new Promise<never>(() => {});

describe("withTimeout", () => {
    test("passes the answer through", async () => {
        await expect(withTimeout(Promise.resolve(7), 1000, "x")).resolves.toBe(7);
    });

    test("passes the error through", async () => {
        await expect(withTimeout(Promise.reject(new Error("boom")), 1000, "x")).rejects.toThrow("boom");
    });

    test("fails with a TimeoutError that names what was waited for", async () => {
        const failure = await withTimeout(never(), 20, "Songlink").catch((e: unknown) => e);
        expect(failure).toBeInstanceOf(TimeoutError);
        expect((failure as Error).message).toMatch(/Songlink did not answer within/);
    });

    test("an answer that comes late (after the limit) is not an unhandled rejection", async () => {
        const late = new Promise<void>((_, reject) => setTimeout(() => reject(new Error("late")), 40));
        await expect(withTimeout(late, 10, "x")).rejects.toBeInstanceOf(TimeoutError);
        await new Promise((r) => setTimeout(r, 60));
    });
});

describe("withTimeouts", () => {
    const api = {
        name: "api",
        quick: async (n: number) => n * 2,
        stalls: () => never(),
        sync: () => "plain",
        usesThis(this: { name: string }) {
            return Promise.resolve(this.name);
        },
    };

    test("each method that returns a promise has a limit, and the others are untouched", async () => {
        const limited = withTimeouts(api, 20, "Client");
        expect(limited.name).toBe("api");
        expect(limited.sync()).toBe("plain");
        await expect(limited.quick(4)).resolves.toBe(8);
        await expect(limited.usesThis()).resolves.toBe("api");
        await expect(limited.stalls()).rejects.toThrow(/Client\.stalls did not answer/);
    });
});

describe("fetchWithTimeout", () => {
    let server: http.Server;
    let url: string;

    beforeAll(async () => {
        server = http.createServer((req, res) => {
            if (req.url === "/ok") res.end("fine");
            // else: never answers
        });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(() => {
        server.closeAllConnections();
        server.close();
    });

    test("a server that answers is read as usual", async () => {
        const response = await fetchWithTimeout(500)(`${url}/ok`);
        expect(await response.text()).toBe("fine");
    });

    test("a server that never answers is given up on", async () => {
        const started = Date.now();
        await expect(fetchWithTimeout(100)(`${url}/stall`)).rejects.toThrow();
        expect(Date.now() - started).toBeLessThan(2000);
    });

    test("the caller's own signal still stops the request", async () => {
        const controller = new AbortController();
        const request = fetchWithTimeout(10_000)(`${url}/stall`, { signal: controller.signal });
        controller.abort();
        await expect(request).rejects.toThrow();
    });
});
