import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { binaryAlertBridge, type BinaryAlertRequest } from "#base/bridges/binaryAlertBridge";
import { withBinaryAlert } from "#utils/withBinaryAlert";

let shown: BinaryAlertRequest[];

beforeEach(() => {
    binaryAlertBridge.reset();
    shown = [];
    binaryAlertBridge.setOpener((req) => shown.push(req));
});

afterEach(() => {
    binaryAlertBridge.setOpener(null);
});

const request = (binary: string): BinaryAlertRequest => ({ binary, impact: "it matters", reason: "no network" });

describe("binaryAlertBridge", () => {
    test("shows an alert once per tool, however many downloads hit the same failure", () => {
        for (let i = 0; i < 50; i++) binaryAlertBridge.report(request("ffmpeg"));
        expect(shown).toHaveLength(1);
    });

    test("alerts separately for different tools", () => {
        binaryAlertBridge.report(request("ffmpeg"));
        binaryAlertBridge.report(request("yt-dlp"));
        expect(shown.map((r) => r.binary)).toEqual(["ffmpeg", "yt-dlp"]);
    });

    test("alerts again after the tool worked in between", () => {
        binaryAlertBridge.report(request("ffmpeg"));
        binaryAlertBridge.resolved("ffmpeg");
        binaryAlertBridge.report(request("ffmpeg"));
        expect(shown).toHaveLength(2);
    });

    test("does nothing without a UI, and does not use up the alert for later", () => {
        binaryAlertBridge.setOpener(null);
        expect(() => binaryAlertBridge.report(request("ffmpeg"))).not.toThrow();

        binaryAlertBridge.setOpener((req) => shown.push(req));
        binaryAlertBridge.report(request("ffmpeg"));
        expect(shown).toHaveLength(1);
    });
});

describe("withBinaryAlert", () => {
    test("returns the result and raises nothing when the setup works", async () => {
        await expect(withBinaryAlert("ffmpeg", "impact", async () => "C:/bin/ffmpeg.exe")).resolves.toBe(
            "C:/bin/ffmpeg.exe"
        );
        expect(shown).toEqual([]);
    });

    test("raises an alert with the error's message and rethrows the very same error", async () => {
        const failure = new Error("Could not download ffmpeg (HTTP 404 from https://example.test/x)");

        const caught = await withBinaryAlert("ffmpeg", "downloads fail", () => Promise.reject(failure)).catch(
            (e: unknown) => e
        );

        expect(caught).toBe(failure);
        expect(shown).toEqual([{ binary: "ffmpeg", impact: "downloads fail", reason: failure.message }]);
    });

    test("one broken tool alerts once across many failing calls, and again after it recovers", async () => {
        const fail = () => Promise.reject(new Error("offline"));
        const results = await Promise.allSettled(Array.from({ length: 5 }, () => withBinaryAlert("yt-dlp", "x", fail)));
        expect(results.every((r) => r.status === "rejected")).toBe(true);
        expect(shown).toHaveLength(1);

        await withBinaryAlert("yt-dlp", "x", async () => "ok");
        await withBinaryAlert("yt-dlp", "x", fail).catch(() => {});
        expect(shown).toHaveLength(2);
    });

    test("describes a non-Error rejection instead of crashing", async () => {
        const setup = vi.fn().mockRejectedValue("plain string");
        await withBinaryAlert("ffprobe", "x", setup).catch(() => {});
        expect(shown[0].reason).toBe("plain string");
    });
});
