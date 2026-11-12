import { describe, expect, test } from "vitest";
import { opensInApp, siteLabel, siteProviderKey, siteRank, toAppUri } from "#utils/appLinks";
import { externalLinks, MAX_EXTERNAL_LINKS } from "#flows/musicDownloadFlow/musicbrainz/externalLinks";

describe("toAppUri: the address that opens a link in its desktop app", () => {
    test("Spotify, with or without the locale segment and the tracking query", () => {
        expect(toAppUri("https://open.spotify.com/album/2ANVost0y2y52ema1E9xAZ")).toBe(
            "spotify:album:2ANVost0y2y52ema1E9xAZ"
        );
        expect(toAppUri("https://open.spotify.com/intl-fr/track/4v7kK?si=QByTNuJ2")).toBe("spotify:track:4v7kK");
        expect(toAppUri("http://open.spotify.com/artist/abc")).toBe("spotify:artist:abc");
    });

    test("Deezer and Tidal", () => {
        expect(toAppUri("https://www.deezer.com/fr/album/302127")).toBe("deezer://www.deezer.com/album/302127");
        expect(toAppUri("https://www.deezer.com/track/3135556")).toBe("deezer://www.deezer.com/track/3135556");
        expect(toAppUri("https://tidal.com/browse/album/79914998")).toBe("tidal://album/79914998");
        expect(toAppUri("https://listen.tidal.com/track/1234")).toBe("tidal://track/1234");
    });

    test("everything else stays a web link, including pages of those sites that are not a track, album, artist or playlist", () => {
        for (const url of [
            "https://artist.bandcamp.com/album/x",
            "https://music.apple.com/fr/album/x/123",
            "https://www.discogs.com/release/1",
            "https://open.spotify.com/user/someone",
            "https://www.deezer.com/en/profile/1",
            "not a link",
        ]) {
            expect(toAppUri(url)).toBe(url);
            expect(opensInApp(url)).toBe(false);
        }
        expect(opensInApp("https://open.spotify.com/album/abc")).toBe(true);
    });
});

describe("siteLabel / siteRank", () => {
    test("names the site; unknown sites show their host", () => {
        expect(siteLabel("https://open.spotify.com/album/x")).toBe("Spotify");
        expect(siteLabel("https://music.apple.com/fr/album/x")).toBe("Apple Music");
        expect(siteLabel("https://artist.bandcamp.com/album/x")).toBe("Bandcamp");
        expect(siteLabel("https://www.discogs.com/release/1")).toBe("Discogs");
        expect(siteLabel("https://www.example.org/page")).toBe("example.org");
        expect(siteLabel("garbage")).toBe("garbage");
    });

    test("known services give the key of their provider (for its colors); other sites have none", () => {
        expect(siteProviderKey("https://open.spotify.com/album/x")).toBe("spotify");
        expect(siteProviderKey("https://music.apple.com/fr/album/x")).toBe("appleMusic");
        expect(siteProviderKey("https://www.deezer.com/fr/album/1")).toBe("deezer");
        expect(siteProviderKey("https://artist.bandcamp.com/album/x")).toBe("bandcamp");
        expect(siteProviderKey("https://musicbrainz.org/release/abc")).toBe("musicBrainz");
        expect(siteProviderKey("https://www.discogs.com/release/1")).toBeUndefined();
        expect(siteProviderKey("https://www.example.org/")).toBeUndefined();
        expect(siteProviderKey("garbage")).toBeUndefined();
    });

    test("where to listen or buy comes before reference pages, unknown sites last", () => {
        expect(siteRank("https://open.spotify.com/a")).toBeLessThan(siteRank("https://www.discogs.com/r"));
        expect(siteRank("https://www.discogs.com/r")).toBeLessThan(siteRank("https://www.example.org/"));
    });
});

describe("externalLinks of a MusicBrainz release", () => {
    const urls = [
        "https://www.discogs.com/release/1",
        "https://musicbrainz.org/release/abc/cover-art",
        "https://open.spotify.com/album/alb1",
        "https://open.spotify.com/intl-fr/album/alb1?si=x", // the same album, written another way
        "https://artist.bandcamp.com/album/x",
        "https://www.example.org/page",
        "not an address",
    ];

    test("streaming and shops first, MusicBrainz' own pages and duplicates left out", () => {
        const links = externalLinks({ urls });
        expect(links.map((l) => l.label)).toEqual(["Spotify", "Bandcamp", "Discogs", "example.org"]);
    });

    test("each link carries its provider key (for its colors) when the app knows the service", () => {
        expect(externalLinks({ urls }).map((l) => l.providerKey)).toEqual([
            "spotify",
            "bandcamp",
            undefined,
            undefined,
        ]);
    });

    test("a link a desktop app handles opens in that app; the others open as they are", () => {
        const [spotify, bandcamp] = externalLinks({ urls });
        expect(spotify.url).toBe("https://open.spotify.com/album/alb1");
        expect(spotify.openUrl).toBe("spotify:album:alb1");
        expect(bandcamp.openUrl).toBe(bandcamp.url);
    });

    test("no links, or links that were never loaded: an empty list", () => {
        expect(externalLinks({})).toEqual([]);
        expect(externalLinks({ urls: [] })).toEqual([]);
    });

    test("at most MAX_EXTERNAL_LINKS, in the order MusicBrainz gave for the same kind of site", () => {
        const many = Array.from({ length: 12 }, (_, i) => `https://shop${i}.example.org/r`);
        const links = externalLinks({ urls: many });
        expect(links).toHaveLength(MAX_EXTERNAL_LINKS);
        expect(links.map((l) => l.url)).toEqual(many.slice(0, MAX_EXTERNAL_LINKS));
    });
});

describe("a link a registered service reads belongs to that service", () => {
    test("its name, color key and app address come from the service, not from the site table", async () => {
        const { urlParserRegistry } = await import("#base/urlParser");
        const { platformRegistry } = await import("#base/platformRegistry");
        const { providerDisplayRegistry } = await import("#base/providerDisplay");
        const { SpotifyService } =
            await import("#flows/musicDownloadFlow/services/metadata-providers/spotify/SpotifyService");

        providerDisplayRegistry.register("fakeplay", {
            label: "FakePlay",
            acronym: "FAKE",
            color: "#123456",
            colorSubtle: "#111111",
            colorBright: "#222222",
        });
        urlParserRegistry.register((url) =>
            url.startsWith("https://fakeplay.test/t/")
                ? { platform: "fakeplay", type: "track", id: url.slice("https://fakeplay.test/t/".length) }
                : null
        );
        platformRegistry.registerOpenUri("fakeplay", (p) => (p.id ? `fakeplay://track/${p.id}` : undefined));

        const url = "https://fakeplay.test/t/abc";
        expect(siteLabel(url)).toBe("FakePlay");
        expect(siteProviderKey(url)).toBe("fakeplay");
        expect(toAppUri(url)).toBe("fakeplay://track/abc");
        expect(opensInApp(url)).toBe(true);
        // A service the table has never heard of still ranks as a place to listen: before the reference sites.
        expect(siteRank(url)).toBeLessThan(siteRank("https://open.spotify.com/a"));

        // A link the service reads but has no app for stays a web link, with the service's name.
        platformRegistry.registerOpenUri("fakeplay", () => undefined);
        expect(toAppUri(url)).toBe(url);
        expect(siteLabel(url)).toBe("FakePlay");

        // Spotify declares its own app address; the table's regex is only the fallback for what it does not read.
        expect(SpotifyService.openUri({ platform: "spotify", type: "album", id: "alb1" })).toBe("spotify:album:alb1");
        expect(SpotifyService.openUri({ platform: "spotify", type: "unknown" })).toBeUndefined();
    });
});
