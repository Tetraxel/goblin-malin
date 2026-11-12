import { afterEach, describe, expect, test, vi } from "vitest";
import { MusicBrainzApiError } from "musicbrainz-api";
import { MusicBrainzClient } from "#flows/musicDownloadFlow/services/apis/musicbrainz-client";

/**
 * The shapes below are what the live MusicBrainz API answered (checked against the real service): a URL's relations
 * carry only a STUB of each release, and the ISRC endpoint returns recordings WITHOUT their releases — those need a
 * lookup by recording id. The client has to make up for both, or the matching rules never see the evidence.
 */

const notFound = () => new MusicBrainzApiError("not found", { status: 404, statusText: "Not Found" });

const fullRelease = {
    id: "rel-1",
    title: "Random Access Memories",
    barcode: "886443927087",
    "artist-credit": [
        { name: "Daft Punk", joinphrase: "", artist: { id: "art-1", name: "Daft Punk", "sort-name": "Daft Punk" } },
    ],
    media: [{ "track-count": 13, format: "Digital Media" }],
    "release-group": { id: "rg-1" },
};

function fakeApi(over: Record<string, unknown> = {}) {
    const calls: { fn: string; args: unknown[] }[] = [];
    const record =
        (fn: string, impl: (...args: never[]) => unknown) =>
        (...args: never[]) => {
            calls.push({ fn, args });
            return impl(...args);
        };
    const api = {
        lookupUrl: record("lookupUrl", async () => ({
            id: "u1",
            resource: "x",
            relations: [{ type: "streaming", release: { id: "rel-1", title: "Random Access Memories" } }],
        })),
        lookup: record("lookup", async (entity: string, id: string) => {
            if (entity === "release") return { ...fullRelease, id };
            if (entity === "isrc")
                return { isrc: "X", recordings: [{ id: "rec-1", title: "Get Lucky", "artist-credit": [] }] };
            if (entity === "recording")
                return {
                    id,
                    title: "Get Lucky",
                    "artist-credit": [],
                    releases: [
                        { ...fullRelease, id: "rel-a" },
                        { ...fullRelease, id: "rel-b" },
                    ],
                };
            throw new Error(`unexpected lookup ${entity}`);
        }),
        search: record("search", async () => ({ releases: [], artists: [] })),
        ...over,
    };
    MusicBrainzClient.setApiForTesting(api as never);
    return { calls, client: new MusicBrainzClient() };
}

afterEach(() => MusicBrainzClient.setApiForTesting(null));

describe("MusicBrainzClient.findReleasesByUrl", () => {
    test("a release that only a URL stub names is fetched in full (artists, track count, release group)", async () => {
        const { client, calls } = fakeApi();
        const [release] = await client.findReleasesByUrl("https://open.spotify.com/album/x");
        expect(release).toMatchObject({
            id: "rel-1",
            barcode: "886443927087",
            trackCount: 13,
            releaseGroupId: "rg-1",
            artists: [{ id: "art-1", name: "Daft Punk" }],
            urls: ["https://open.spotify.com/album/x"],
        });
        expect(calls.map((c) => c.fn)).toEqual(["lookupUrl", "lookup"]);
    });

    test("an unknown URL (404) is an empty list, not an error", async () => {
        const { client } = fakeApi({
            lookupUrl: async () => {
                throw notFound();
            },
        });
        expect(await client.findReleasesByUrl("https://open.spotify.com/album/none")).toEqual([]);
    });

    test("any other failure is thrown, so the check is recorded as failed — never as 'none found'", async () => {
        const { client } = fakeApi({
            lookupUrl: async () => {
                throw new MusicBrainzApiError("busy", { status: 503, statusText: "Service Unavailable" });
            },
        });
        await expect(client.findReleasesByUrl("https://open.spotify.com/album/x")).rejects.toThrow(/busy/);
    });

    test("a URL on many releases fetches only the first few in full", async () => {
        const stubs = Array.from({ length: 6 }, (_, i) => ({ type: "x", release: { id: `rel-${i}`, title: "T" } }));
        const { client, calls } = fakeApi({ lookupUrl: async () => ({ id: "u", resource: "x", relations: stubs }) });
        const releases = await client.findReleasesByUrl("https://open.spotify.com/album/x");
        expect(releases).toHaveLength(6);
        expect(calls.filter((c) => c.fn === "lookup")).toHaveLength(3);
    });
});

describe("MusicBrainzClient.findRecordingsByIsrc", () => {
    test("the recording is looked up by id to get its releases (the ISRC endpoint has none)", async () => {
        const { client, calls } = fakeApi();
        const [recording] = await client.findRecordingsByIsrc("USQX91300108");
        expect(recording.id).toBe("rec-1");
        expect(recording.releases.map((r) => r.id)).toEqual(["rel-a", "rel-b"]);
        expect(recording.releases[0]).toMatchObject({ trackCount: 13, releaseGroupId: "rg-1" });
        expect(calls.map((c) => `${c.fn}:${c.args[0]}`)).toEqual(["lookup:isrc", "lookup:recording"]);
    });

    test("an unknown ISRC (404) is an empty list", async () => {
        const { client } = fakeApi({
            lookup: async () => {
                throw notFound();
            },
        });
        expect(await client.findRecordingsByIsrc("ZZZ")).toEqual([]);
    });
});

describe("MusicBrainzClient searches", () => {
    test("a barcode search is exact and small", async () => {
        const { client, calls } = fakeApi();
        await client.findReleasesByBarcode("5059000000017");
        expect(calls[0].args).toEqual(["release", { query: 'barcode:"5059000000017"', limit: 5 }]);
    });

    test("quotes in titles cannot break out of the query", async () => {
        const { client, calls } = fakeApi();
        await client.searchReleases({ title: 'The "Best" Of', artist: "AC\\DC" });
        const query = (calls[0].args[1] as { query: string }).query;
        expect(query).toBe('release:"The \\"Best\\" Of" AND artist:"AC\\\\DC"');
    });

    test("search results keep MusicBrainz' own score", async () => {
        const { client } = fakeApi({
            search: vi.fn(async () => ({ releases: [{ ...fullRelease, score: 97 }] })),
        });
        const [hit] = await client.searchReleases({ title: "Random Access Memories" });
        expect(hit.score).toBe(97);
        expect(hit.trackCount).toBe(13);
    });
});

describe("MusicBrainzClient.findReleasesInGroup", () => {
    test("browses the group's releases once, with their format and track count", async () => {
        const browse = vi.fn(async () => ({
            releases: [
                { ...fullRelease, id: "rel-cd", media: [{ "track-count": 13, format: "CD" }] },
                { ...fullRelease, id: "rel-digital", barcode: undefined },
            ],
        }));
        const { client } = fakeApi({ browse });
        const releases = await client.findReleasesInGroup("rg-1");
        expect(releases.map((r) => [r.id, r.format, r.trackCount, r.releaseGroupId])).toEqual([
            ["rel-cd", "CD", 13, "rg-1"],
            ["rel-digital", "Digital Media", 13, "rg-1"],
        ]);
        expect(browse).toHaveBeenCalledTimes(1);
        expect(browse).toHaveBeenCalledWith(
            "release",
            { "release-group": "rg-1", limit: 100 },
            expect.arrayContaining(["media"])
        );
    });

    test("a failure is thrown, so the caller records it instead of reading it as 'no editions'", async () => {
        const { client } = fakeApi({
            browse: vi.fn(async () => {
                throw new Error("503");
            }),
        });
        await expect(client.findReleasesInGroup("rg-1")).rejects.toThrow("503");
    });
});
