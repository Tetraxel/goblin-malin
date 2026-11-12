import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
    checkMusicBrainzIdentity,
    clearMusicBrainzMemory,
    unknownIdentity,
    type MusicBrainzLookups,
} from "#flows/musicDownloadFlow/musicbrainz/identityCheck";
import { computeCompiledMetadata, musicBrainzIdsFromIdentity } from "#flows/musicDownloadFlow/utils/compiledMetadata";
import { compiledMetadataToTags } from "#flows/musicDownloadFlow/utils/compiledMetadataToTags";
import { luceneQuote } from "#flows/musicDownloadFlow/services/apis/musicbrainz-client";
import { toMbRecording, toMbRelease } from "#flows/musicDownloadFlow/musicbrainz/mapMusicBrainz";
import type {
    MbArtistRef,
    MbRelease,
    MusicBrainzIdentity,
    ProviderAlbum,
} from "#flows/musicDownloadFlow/musicbrainz/types";

const AURORA: MbArtistRef = { id: "artist-aurora", name: "Aurora Vale" };
const OTHER: MbArtistRef = { id: "artist-other", name: "Aurora Vale", disambiguation: "UK folk singer" };

const release = (id: string, over: Partial<MbRelease> = {}): MbRelease => ({
    id,
    title: "Night Drive",
    artists: [AURORA],
    barcode: "5059000000017",
    trackCount: 9,
    releaseGroupId: `rg-${id}`,
    ...over,
});

const album = (over: Partial<ProviderAlbum> = {}): ProviderAlbum => ({
    id: "alb1",
    name: "Night Drive",
    url: "https://open.spotify.com/album/alb1",
    barcode: "5059000000017",
    trackCount: 9,
    artists: [{ name: "Aurora Vale", url: "https://open.spotify.com/artist/aurora" }],
    tracks: [],
    ...over,
});

const track = (over = {}) => ({
    name: "Night Drive",
    isrc: "FRT092400049",
    artists: [{ name: "Aurora Vale", url: "https://open.spotify.com/artist/aurora" }],
    ...over,
});

/** A fake MusicBrainz whose every call is counted, and whose answers a test sets. */
function fakeLookups(over: Partial<MusicBrainzLookups> = {}) {
    const calls: Record<string, number> = {};
    const count =
        <A extends unknown[], R>(name: string, fn: (...args: A) => Promise<R>) =>
        (...args: A): Promise<R> => {
            calls[name] = (calls[name] ?? 0) + 1;
            return fn(...args);
        };
    const lookups: MusicBrainzLookups = {
        findReleasesByBarcode: count("barcode", async () => []),
        findReleasesByUrl: count("url", async () => []),
        findArtistsByUrl: count("artistUrl", async () => []),
        findRecordingsByIsrc: count("isrc", async () => []),
        searchReleases: count("search", async () => []),
        searchArtists: count("artistSearch", async () => []),
        getRelease: count("getRelease", async (id: string) => release(id)),
        findReleasesInGroup: count("group", async () => []),
    };
    for (const [key, fn] of Object.entries(over)) {
        (lookups as unknown as Record<string, unknown>)[key] = count(key, fn as never);
    }
    return { lookups, calls };
}

beforeEach(() => clearMusicBrainzMemory());
afterEach(() => vi.useRealTimers());

describe("checkMusicBrainzIdentity", () => {
    test("nothing anywhere → notFound, and every check was asked", async () => {
        const { lookups, calls } = fakeLookups();
        const id = await checkMusicBrainzIdentity(lookups, album(), track());
        expect(id.verdict).toBe("notFound");
        expect(calls).toMatchObject({ barcode: 1, url: 1, isrc: 1, search: 1, artistUrl: 1 });
    });

    test("a missing barcode / ISRC is a skipped check, so the verdict is unknown", async () => {
        const { lookups, calls } = fakeLookups();
        const id = await checkMusicBrainzIdentity(lookups, album({ barcode: undefined }), track({ isrc: undefined }));
        expect(id.verdict).toBe("unknown");
        expect(calls.barcode).toBeUndefined();
        expect(calls.isrc).toBeUndefined();
        expect(id.checks.filter((c) => c.status === "skipped").map((c) => c.name)).toEqual(["barcode", "isrc"]);
    });

    test("a failing lookup is recorded, never read as 'none found'", async () => {
        const { lookups } = fakeLookups({
            findReleasesByUrl: async () => {
                throw new Error("503 Service Unavailable");
            },
        });
        const id = await checkMusicBrainzIdentity(lookups, album(), track());
        expect(id.verdict).toBe("unknown");
        expect(id.checks.find((c) => c.name === "url")).toMatchObject({
            status: "failed",
            note: "503 Service Unavailable",
        });
    });

    test("a failure is not remembered: the next track asks again", async () => {
        let attempts = 0;
        const { lookups } = fakeLookups({
            findReleasesByUrl: async () => {
                attempts++;
                if (attempts === 1) throw new Error("timeout");
                return [release("rel-1", { barcode: undefined })];
            },
        });
        const first = await checkMusicBrainzIdentity(lookups, album(), track());
        expect(first.verdict).toBe("unknown");
        const second = await checkMusicBrainzIdentity(lookups, album(), track({ isrc: "OTHER" }));
        expect(second.verdict).toBe("matched");
        expect(attempts).toBe(2);
    });

    test("tracks of one album share the album-level answers; each asks its own ISRC", async () => {
        const { lookups, calls } = fakeLookups();
        await Promise.all([
            checkMusicBrainzIdentity(lookups, album(), track({ isrc: "AAA" })),
            checkMusicBrainzIdentity(lookups, album(), track({ isrc: "BBB" })),
            checkMusicBrainzIdentity(lookups, album(), track({ isrc: "CCC" })),
        ]);
        expect(calls).toMatchObject({ barcode: 1, url: 1, search: 1, artistUrl: 1, isrc: 3 });
    });

    test("an album link is looked up in its canonical form", async () => {
        const urlSeen: string[] = [];
        const { lookups } = fakeLookups({
            findReleasesByUrl: async (url: string) => {
                urlSeen.push(url);
                return [];
            },
        });
        await checkMusicBrainzIdentity(
            lookups,
            album({ url: "https://open.spotify.com/intl-fr/album/alb1?si=QByTNuJ2" }),
            track()
        );
        expect(urlSeen).toEqual(["https://open.spotify.com/album/alb1"]);
    });

    test("a re-check asks again — except for answers fetched a moment ago", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-11-11T10:00:00Z"));
        const { lookups, calls } = fakeLookups();
        await checkMusicBrainzIdentity(lookups, album(), track());
        await checkMusicBrainzIdentity(lookups, album(), track(), { force: true });
        expect(calls.barcode).toBe(1); // 0 s later: still fresh

        vi.setSystemTime(new Date("2026-11-11T10:00:10Z"));
        await checkMusicBrainzIdentity(lookups, album(), track(), { force: true });
        expect(calls.barcode).toBe(2);
    });

    test("an artist the evidence cannot link gets same-name candidates, and no link", async () => {
        const { lookups, calls } = fakeLookups({ searchArtists: async () => [AURORA, OTHER] });
        const id = await checkMusicBrainzIdentity(lookups, album(), track());
        expect(calls.searchArtists).toBe(1);
        expect(id.artists[0].mbid).toBeUndefined();
        expect(id.artists[0].candidates.map((c) => c.id)).toEqual(["artist-aurora", "artist-other"]);
    });

    test("an artist linked by its streaming page needs no name search", async () => {
        const { lookups, calls } = fakeLookups({ findArtistsByUrl: async () => [AURORA] });
        const id = await checkMusicBrainzIdentity(lookups, album(), track());
        expect(calls.searchArtists).toBeUndefined();
        expect(id.artists[0]).toMatchObject({ mbid: "artist-aurora", evidence: "url" });
    });

    test("a release reported by the editor is fetched by id and must show evidence", async () => {
        const added = release("rel-new", { urls: ["https://open.spotify.com/album/alb1"] });
        const { lookups, calls } = fakeLookups({ getRelease: async () => added });
        const id = await checkMusicBrainzIdentity(lookups, album({ barcode: undefined }), track(), {
            knownReleaseId: "rel-new",
        });
        expect(calls.getRelease).toBe(1);
        expect(id.verdict).toBe("matched");
        expect(id.release?.id).toBe("rel-new");
    });

    test("a matched release asks for its release group once, and the digital edition wins", async () => {
        const cd = release("rel-cd", { format: "CD", releaseGroupId: "rg-1" });
        const digital = release("rel-digital", { format: "Digital Media", barcode: undefined, releaseGroupId: "rg-1" });
        const { lookups, calls } = fakeLookups({
            findReleasesByBarcode: async () => [cd],
            findReleasesInGroup: async () => [cd, digital],
        });
        const first = await checkMusicBrainzIdentity(lookups, album(), track({ isrc: "AAA" }));
        const second = await checkMusicBrainzIdentity(lookups, album(), track({ isrc: "BBB" }));
        expect(first.release?.id).toBe("rel-digital");
        expect(second.release?.id).toBe("rel-digital");
        expect(calls.findReleasesInGroup).toBe(1); // shared by the album's tracks
    });

    test("no match, no release group lookup; a failing one leaves the match as it was", async () => {
        const none = fakeLookups();
        await checkMusicBrainzIdentity(none.lookups, album(), track());
        expect(none.calls.findReleasesInGroup).toBeUndefined();
        clearMusicBrainzMemory();

        const cd = release("rel-cd", { format: "CD", releaseGroupId: "rg-1" });
        const broken = fakeLookups({
            findReleasesByBarcode: async () => [cd],
            findReleasesInGroup: async () => {
                throw new Error("503");
            },
        });
        const id = await checkMusicBrainzIdentity(broken.lookups, album(), track());
        expect(id).toMatchObject({ verdict: "matched" });
        expect(id.release?.id).toBe("rel-cd");
    });

    test("the user's earlier choice is applied", async () => {
        const { lookups } = fakeLookups();
        const chosen = release("rel-chosen");
        const id = await checkMusicBrainzIdentity(lookups, album(), track(), {
            user: { chosenRelease: chosen, rejectedReleaseIds: [], artistChoices: {} },
        });
        expect(id).toMatchObject({ verdict: "matched", decidedBy: "user" });
    });
});

describe("the identity feeds the file's tags", () => {
    const matched: MusicBrainzIdentity = {
        verdict: "matched",
        decidedBy: "auto",
        checkedAt: "2026-11-11T10:00:00.000Z",
        release: release("rel-1"),
        recordingId: "rec-1",
        releaseGroupId: "rg-1",
        artists: [
            { name: "Someone", candidates: [] },
            { name: "Aurora Vale", mbid: "artist-aurora", evidence: "url", candidates: [] },
        ],
        candidates: [],
        checks: [],
        evidence: [],
    };

    test("a matched identity gives every id; the artist is the first one linked on evidence", () => {
        expect(musicBrainzIdsFromIdentity({ ...matched, releaseTrackId: "trk-1" })).toEqual({
            recording: "rec-1",
            release: "rel-1",
            releaseGroup: "rg-1",
            artist: "artist-aurora",
            // The release's own credit, not the track's artists.
            albumArtists: ["artist-aurora"],
            releaseTrack: "trk-1",
        });
    });

    test("the release track is asked once the release and the recording are known", async () => {
        const rel = release("rel-1", { barcode: undefined });
        const { lookups, calls } = fakeLookups({
            findReleasesByUrl: async () => [rel],
            findRecordingsByIsrc: async () => [
                { id: "rec-1", title: "Night Drive", artists: [AURORA], releases: [rel] },
            ],
            findReleaseTrackId: async () => "trk-1",
        });
        const id = await checkMusicBrainzIdentity(lookups, album(), track());
        expect(id).toMatchObject({ verdict: "matched", recordingId: "rec-1", releaseTrackId: "trk-1" });
        expect(calls.findReleaseTrackId).toBe(1);
    });

    test("no release track when its lookup fails or the release does not list the recording", async () => {
        const rel = release("rel-1", { barcode: undefined });
        const base = {
            findReleasesByUrl: async () => [rel],
            findRecordingsByIsrc: async () => [
                { id: "rec-1", title: "Night Drive", artists: [AURORA], releases: [rel] },
            ],
        };
        const missing = fakeLookups({ ...base, findReleaseTrackId: async () => undefined });
        expect((await checkMusicBrainzIdentity(missing.lookups, album(), track())).releaseTrackId).toBeUndefined();
        clearMusicBrainzMemory();
        const broken = fakeLookups({
            ...base,
            findReleaseTrackId: async () => {
                throw new Error("503");
            },
        });
        const id = await checkMusicBrainzIdentity(broken.lookups, album(), track());
        // The match itself stands; only the id is left out.
        expect(id).toMatchObject({ verdict: "matched" });
        expect(id.releaseTrackId).toBeUndefined();
    });

    test("without a matched release only the recording and artist are given", () => {
        const review = { ...matched, verdict: "needsReview" as const, release: undefined, releaseGroupId: undefined };
        expect(musicBrainzIdsFromIdentity(review)).toEqual({ recording: "rec-1", artist: "artist-aurora" });
        expect(musicBrainzIdsFromIdentity(unknownIdentity("x"))).toBeUndefined();
        expect(musicBrainzIdsFromIdentity(undefined)).toBeUndefined();
    });

    test("computeCompiledMetadata carries them, and the tags include them only when allowed", () => {
        const compiled = computeCompiledMetadata([], {}, { ...matched, releaseTrackId: "trk-1" });
        expect(compiled.musicBrainzIds?.release).toBe("rel-1");
        expect(compiledMetadataToTags(compiled, { includeMusicBrainzTags: true })).toMatchObject({
            musicBrainzTrackId: "rec-1",
            musicBrainzAlbumId: "rel-1",
            musicBrainzArtistId: "artist-aurora",
            musicBrainzAlbumArtistIds: ["artist-aurora"],
            musicBrainzReleaseGroupId: "rg-1",
            musicBrainzReleaseTrackId: "trk-1",
        });
        const off = compiledMetadataToTags(compiled, { includeMusicBrainzTags: false });
        expect(off.musicBrainzAlbumId).toBeUndefined();
        expect(off.musicBrainzAlbumArtistIds).toBeUndefined();
        expect(off.musicBrainzReleaseTrackId).toBeUndefined();
    });
});

describe("MusicBrainz plumbing", () => {
    test("Lucene phrases are escaped", () => {
        expect(luceneQuote('He said "hi" \\ bye')).toBe('"He said \\"hi\\" \\\\ bye"');
    });

    test("releases and recordings from the API are trimmed to what the resolver needs", () => {
        const r = toMbRelease({
            id: "r1",
            title: "T",
            barcode: "",
            media: [{ "track-count": 5, format: "Digital Media" }, { "track-count": 4 }],
            "artist-credit": [{ name: "x", joinphrase: "", artist: { id: "a1", name: "A", "sort-name": "A" } }],
            "release-group": { id: "g1" },
            relations: [{ url: { id: "u", resource: "https://open.spotify.com/album/z" } }],
        } as never);
        expect(r).toMatchObject({
            id: "r1",
            trackCount: 9,
            format: "Digital Media",
            releaseGroupId: "g1",
            urls: ["https://open.spotify.com/album/z"],
            artists: [{ id: "a1", name: "A" }],
        });
        expect(r.barcode).toBeUndefined();

        const rec = toMbRecording({
            id: "rec",
            title: "S",
            length: 1000,
            releases: [{ id: "r1", title: "T" }],
        } as never);
        expect(rec).toMatchObject({ id: "rec", lengthMs: 1000, releases: [{ id: "r1" }] });
    });
});
