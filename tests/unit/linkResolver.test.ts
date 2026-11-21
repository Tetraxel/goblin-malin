import { describe, expect, test, vi } from "vitest";
import { urlParserRegistry } from "#base/urlParser";

// The registry is shared by the whole app: this resolver only claims links of a host no service reads.
const follow = vi.fn<(url: string) => Promise<string>>();
urlParserRegistry.registerResolver((url) => (url.startsWith("https://short.test/") ? follow(url) : null));

describe("urlParserRegistry.resolve", () => {
    test("a short link is followed once, any other link is given back as it is", async () => {
        follow.mockResolvedValue("https://long.test/album/1");
        await expect(urlParserRegistry.resolve("https://short.test/a")).resolves.toBe("https://long.test/album/1");
        await expect(urlParserRegistry.resolve("https://short.test/a")).resolves.toBe("https://long.test/album/1");
        expect(follow).toHaveBeenCalledTimes(1);

        await expect(urlParserRegistry.resolve("https://open.spotify.com/track/x")).resolves.toBe(
            "https://open.spotify.com/track/x"
        );
    });

    test("a link that cannot be followed stays as it was, and is tried again next time", async () => {
        follow.mockReset();
        follow.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce("https://long.test/track/2");
        await expect(urlParserRegistry.resolve("https://short.test/b")).resolves.toBe("https://short.test/b");
        await new Promise((resolve) => setTimeout(resolve, 0));
        await expect(urlParserRegistry.resolve("https://short.test/b")).resolves.toBe("https://long.test/track/2");
        expect(follow).toHaveBeenCalledTimes(2);
    });

    test("resolveAll keeps the order", async () => {
        follow.mockReset();
        follow.mockImplementation(async (url) => url.replace("short.test", "long.test"));
        await expect(
            urlParserRegistry.resolveAll(["https://short.test/c", "https://x.test/1", "https://short.test/d"])
        ).resolves.toEqual(["https://long.test/c", "https://x.test/1", "https://long.test/d"]);
    });
});
