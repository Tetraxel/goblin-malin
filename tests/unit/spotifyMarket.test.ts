import { describe, test, expect } from "vitest";
import { resolveSpotifyMarket } from "#flows/musicDownloadFlow/services/metadata-providers/spotify/spotifyMarket";
import { platformRegistry } from "#base/platformRegistry";

describe("resolveSpotifyMarket", () => {
    test("uses the configured market, normalised", () => {
        expect(resolveSpotifyMarket("de", "en-US")).toBe("DE");
        expect(resolveSpotifyMarket("  jp ", "en-US")).toBe("JP");
    });

    test("falls back to the system locale's country when the setting is empty or invalid", () => {
        expect(resolveSpotifyMarket("", "fr-FR")).toBe("FR");
        expect(resolveSpotifyMarket(undefined, "en-GB")).toBe("GB");
        expect(resolveSpotifyMarket("France", "en-US")).toBe("US");
        expect(resolveSpotifyMarket(42, "pt-BR")).toBe("BR");
    });

    test("infers the likely country from a language-only locale", () => {
        expect(resolveSpotifyMarket("", "fr")).toBe("FR");
    });

    test("sends no market when nothing usable is known", () => {
        expect(resolveSpotifyMarket("", "en-001")).toBeUndefined();
        expect(resolveSpotifyMarket("", "not a locale")).toBeUndefined();
    });
});

describe("platformRegistry", () => {
    test("resolves aliases and track urls, and leaves unknown platforms alone", () => {
        platformRegistry.registerAliases("exampleMain", ["exampleAlias"]);
        platformRegistry.registerTrackUrl("exampleMain", (id) => `https://example.test/${id}`);

        expect(platformRegistry.canonical("exampleAlias")).toBe("exampleMain");
        expect(platformRegistry.canonical("exampleMain")).toBe("exampleMain");
        expect(platformRegistry.canonical("somethingElse")).toBe("somethingElse");
        expect(platformRegistry.trackUrl("exampleAlias", "7")).toBe("https://example.test/7");
        expect(platformRegistry.trackUrl("somethingElse", "7")).toBeUndefined();
    });
});
