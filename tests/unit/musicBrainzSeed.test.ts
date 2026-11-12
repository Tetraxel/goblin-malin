import { afterEach, describe, expect, test } from "vitest";
import * as http from "http";
import {
    buildReleaseSeed,
    describeArtistLink,
    formatSeedPreview,
    type ReleaseSeedInput,
} from "#flows/musicDownloadFlow/musicbrainz/buildReleaseSeed";
import { harmonyReleaseUrl, DEFAULT_HARMONY_URL } from "#flows/musicDownloadFlow/musicbrainz/harmonyLink";
import {
    escapeHtml,
    renderSeedPage,
    startSeedSession,
    type SeedSession,
} from "#flows/musicDownloadFlow/musicbrainz/seedServer";
import type { MbResolvedArtist, ProviderAlbum } from "#flows/musicDownloadFlow/musicbrainz/types";

// ── Fixtures ─────────────────────────────────────────────────────────────────────────────

const album = (over: Partial<ProviderAlbum> = {}): ProviderAlbum => ({
    id: "alb1",
    name: "Night Drive",
    url: "https://open.spotify.com/intl-fr/album/alb1?si=abc",
    albumType: "album",
    releaseDate: "2024-03-01",
    barcode: "5059000000017",
    trackCount: 2,
    artists: [{ name: "Aurora Vale", url: "https://open.spotify.com/artist/aurora" }],
    tracks: [
        {
            id: "t1",
            name: "Night Drive",
            number: 1,
            discNumber: 1,
            durationMs: 200_500,
            isrc: "AAA",
            artists: [{ name: "Aurora Vale" }],
        },
        {
            id: "t2",
            name: "Day Drive",
            number: 2,
            discNumber: 1,
            durationMs: 180_000,
            isrc: "BBB",
            artists: [{ name: "Aurora Vale" }, { name: "Kay" }],
        },
    ],
    ...over,
});

const linked: MbResolvedArtist = { name: "Aurora Vale", mbid: "artist-aurora", evidence: "url", candidates: [] };
const unlinked: MbResolvedArtist = { name: "Aurora Vale", candidates: [] };

const seed = (over: Partial<ReleaseSeedInput> = {}) =>
    buildReleaseSeed({
        album: album(),
        albumArtists: [linked],
        editNote: "Seeded by Goblin Malin",
        ...over,
    });

const get = (fields: readonly (readonly [string, string])[], name: string) => fields.find(([n]) => n === name)?.[1];
const all = (fields: readonly (readonly [string, string])[], name: string) =>
    fields.filter(([n]) => n === name).map(([, v]) => v);

// ── The seed ─────────────────────────────────────────────────────────────────────────────

describe("buildReleaseSeed", () => {
    test("release data: name, status, type, barcode, date, worldwide digital release, canonical link, edit note", () => {
        const { fields } = seed();
        expect(get(fields, "name")).toBe("Night Drive");
        expect(get(fields, "status")).toBe("official");
        expect(all(fields, "type")).toEqual(["Album"]);
        expect(get(fields, "barcode")).toBe("5059000000017");
        expect(get(fields, "events.0.date.year")).toBe("2024");
        expect(get(fields, "events.0.date.month")).toBe("3");
        expect(get(fields, "events.0.date.day")).toBe("1");
        expect(get(fields, "events.0.country")).toBe("XW");
        expect(get(fields, "mediums.0.format")).toBe("Digital Media");
        expect(get(fields, "urls.0.url")).toBe("https://open.spotify.com/album/alb1");
        expect(get(fields, "edit_note")).toBe("Seeded by Goblin Malin");
    });

    test("nothing is invented: no barcode, no date, no type → none of those fields", () => {
        const { fields } = seed({ album: album({ barcode: undefined, releaseDate: undefined, albumType: undefined }) });
        expect(get(fields, "barcode")).toBeUndefined();
        expect(get(fields, "events.0.date.year")).toBeUndefined();
        expect(get(fields, "events.0.country")).toBeUndefined();
        expect(all(fields, "type")).toEqual([]);
    });

    test("a year-only date sends only the year", () => {
        const { fields } = seed({ album: album({ releaseDate: "2019" }) });
        expect(get(fields, "events.0.date.year")).toBe("2019");
        expect(get(fields, "events.0.date.month")).toBeUndefined();
    });

    test("a compilation is an Album with the Compilation secondary type", () => {
        expect(all(seed({ album: album({ albumType: "compilation" }) }).fields, "type")).toEqual([
            "Album",
            "Compilation",
        ]);
    });

    test("a linked artist is sent by MBID; an unlinked one by name only, so the editor searches", () => {
        const withLink = seed({ albumArtists: [linked] }).fields;
        expect(get(withLink, "artist_credit.names.0.mbid")).toBe("artist-aurora");
        expect(get(withLink, "artist_credit.names.0.name")).toBe("Aurora Vale");
        expect(get(withLink, "artist_credit.names.0.artist.name")).toBeUndefined();

        const without = seed({ albumArtists: [unlinked] }).fields;
        expect(get(without, "artist_credit.names.0.mbid")).toBeUndefined();
        expect(get(without, "artist_credit.names.0.artist.name")).toBe("Aurora Vale");
    });

    test("several album artists are joined naturally", () => {
        const { fields } = seed({
            album: album({ artists: [{ name: "A" }, { name: "B" }, { name: "C" }] }),
            albumArtists: [],
        });
        expect(get(fields, "artist_credit.names.0.join_phrase")).toBe(", ");
        expect(get(fields, "artist_credit.names.1.join_phrase")).toBe(" & ");
        expect(get(fields, "artist_credit.names.2.join_phrase")).toBeUndefined();
    });

    test("tracks: name, number, length in ms; a recording only where one was given", () => {
        const { fields, preview } = seed({ recordingByTrackId: { t1: "rec-1" } });
        expect(get(fields, "mediums.0.track.0.name")).toBe("Night Drive");
        expect(get(fields, "mediums.0.track.0.number")).toBe("1");
        expect(get(fields, "mediums.0.track.0.length")).toBe("200500");
        expect(get(fields, "mediums.0.track.0.recording")).toBe("rec-1");
        expect(get(fields, "mediums.0.track.1.recording")).toBeUndefined();
        expect(preview.reusedRecordings).toBe(1);
        expect(preview.trackCount).toBe(2);
    });

    test("a track credited differently from the album carries its own credit", () => {
        const { fields } = seed();
        expect(get(fields, "mediums.0.track.0.artist_credit.names.0.name")).toBeUndefined();
        expect(get(fields, "mediums.0.track.1.artist_credit.names.0.name")).toBe("Aurora Vale");
        expect(get(fields, "mediums.0.track.1.artist_credit.names.1.name")).toBe("Kay");
    });

    test("discs become mediums, in order", () => {
        const a = album({
            tracks: [
                { id: "d2", name: "Two", number: 1, discNumber: 2, artists: [{ name: "Aurora Vale" }] },
                { id: "d1", name: "One", number: 1, discNumber: 1, artists: [{ name: "Aurora Vale" }] },
            ],
        });
        const { fields } = seed({ album: a });
        expect(get(fields, "mediums.0.track.0.name")).toBe("One");
        expect(get(fields, "mediums.1.track.0.name")).toBe("Two");
        expect(get(fields, "mediums.1.format")).toBe("Digital Media");
    });

    test("without a track list the editor still opens (no medium fields)", () => {
        const { fields, preview } = seed({ album: album({ tracks: [] }) });
        expect(fields.some(([n]) => n.startsWith("mediums"))).toBe(false);
        expect(preview.trackCount).toBe(0);
    });

    test("redirect_uri is the last field and only present when asked for", () => {
        expect(seed().fields.some(([n]) => n === "redirect_uri")).toBe(false);
        const { fields } = seed({ redirectUri: "http://127.0.0.1:5/done/x" });
        expect(fields[fields.length - 1]).toEqual(["redirect_uri", "http://127.0.0.1:5/done/x"]);
    });

    test("the preview says how each artist is linked, and nothing is hidden from the user", () => {
        const { preview } = seed({ albumArtists: [unlinked] });
        expect(preview.artists[0].how).toContain("not linked");
        expect(describeArtistLink(linked)).toContain("matched by their streaming page");
        expect(describeArtistLink({ ...unlinked, isNew: true })).toContain("new artist");
        const text = formatSeedPreview(preview, "Opens Harmony");
        expect(text).toContain("Night Drive");
        expect(text).toContain("Nothing is submitted by Goblin Malin");
    });
});

describe("Harmony link", () => {
    test("url and gtin are query parameters of the release page", () => {
        const link = harmonyReleaseUrl(
            "https://harmony.example.org/",
            "https://open.spotify.com/album/alb1",
            "5059000000017"
        );
        const parsed = new URL(link);
        expect(parsed.origin + parsed.pathname).toBe("https://harmony.example.org/release");
        expect(parsed.searchParams.get("url")).toBe("https://open.spotify.com/album/alb1");
        expect(parsed.searchParams.get("gtin")).toBe("5059000000017");
    });

    test("no barcode → no gtin; an unusable base falls back to the public instance", () => {
        const link = harmonyReleaseUrl("javascript:alert(1)", "https://open.spotify.com/album/alb1");
        expect(link.startsWith(`${DEFAULT_HARMONY_URL}/release?`)).toBe(true);
        expect(new URL(link).searchParams.has("gtin")).toBe(false);
    });
});

// ── The page and the server ──────────────────────────────────────────────────────────────

describe("seed page", () => {
    test("every value is escaped, the form posts to MusicBrainz", () => {
        const html = renderSeedPage([["name", `"><script>alert(1)</script>`]]);
        expect(html).not.toContain("<script>alert");
        expect(html).toContain("&quot;&gt;&lt;script&gt;");
        expect(html).toContain('method="post" action="https://musicbrainz.org/release/add"');
        expect(escapeHtml(`a&b'c`)).toBe("a&amp;b&#39;c");
    });
});

function request(url: string, hostHeader?: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            {
                host: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                headers: hostHeader ? { Host: hostHeader } : {},
            },
            (res) => {
                let body = "";
                res.on("data", (c) => (body += c));
                res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
            }
        );
        req.on("error", reject);
        req.end();
    });
}

describe("seed server", () => {
    let session: SeedSession | undefined;
    afterEach(() => {
        session?.close();
        session = undefined;
    });

    const MBID = "4587fe99-db0e-4553-a56a-164dd38ab380";

    test("serves the seeded form, and the redirect target it was given is inside it", async () => {
        let redirect = "";
        session = await startSeedSession((r) => {
            redirect = r;
            return [
                ["name", "Night Drive"],
                ["redirect_uri", r],
            ];
        });
        expect(session.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/seed\/[0-9a-f]{32}$/);
        const page = await request(session.url);
        expect(page.status).toBe(200);
        expect(page.body).toContain('name="name" value="Night Drive"');
        expect(page.body).toContain(`value="${redirect}"`);
    });

    test("a release id on the way back ends the session with that id", async () => {
        let redirect = "";
        session = await startSeedSession((r) => ((redirect = r), [["name", "x"]]));
        const back = await request(`${redirect}?release_mbid=${MBID.toUpperCase()}`);
        expect(back.status).toBe(200);
        expect(await session.outcome).toEqual({ reason: "added", releaseMbid: MBID });
    });

    test("anything that is not a release id is 'returned', not 'added'", async () => {
        let redirect = "";
        session = await startSeedSession((r) => ((redirect = r), [["name", "x"]]));
        await request(`${redirect}?release_mbid=../../etc/passwd`);
        expect(await session.outcome).toEqual({ reason: "returned" });
    });

    test("wrong token, other paths and a foreign Host header are all 404", async () => {
        session = await startSeedSession(() => [["name", "x"]]);
        const base = new URL(session.url);
        expect((await request(`${base.origin}/seed/${"0".repeat(32)}`)).status).toBe(404);
        expect((await request(`${base.origin}/`)).status).toBe(404);
        expect((await request(`${base.origin}/done/${"0".repeat(32)}?release_mbid=${MBID}`)).status).toBe(404);
        expect((await request(session.url, "evil.example.com")).status).toBe(404);
        // None of that ended the session.
        expect((await request(session.url)).status).toBe(200);
    });

    test("it gives up after the timeout, and close() ends it at once", async () => {
        const short = await startSeedSession(() => [["name", "x"]], { timeoutMs: 20 });
        expect(await short.outcome).toEqual({ reason: "timeout" });

        session = await startSeedSession(() => [["name", "x"]]);
        session.close();
        expect(await session.outcome).toEqual({ reason: "closed" });
    });

    test("it is one-shot: after the redirect nothing answers any more", async () => {
        let redirect = "";
        session = await startSeedSession((r) => ((redirect = r), [["name", "x"]]));
        const seedUrl = session.url;
        await request(`${redirect}?release_mbid=${MBID}`);
        await session.outcome;
        await new Promise((r) => setTimeout(r, 50));
        await expect(request(seedUrl)).rejects.toBeTruthy();
    });
});
