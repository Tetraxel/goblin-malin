import { describe, expect, test } from "vitest";
import { resolveMusicBrainzIdentity, resolveArtist } from "#flows/musicDownloadFlow/musicbrainz/resolveIdentity";
import {
    normalizeBarcode,
    normalizeUrl,
    canonicalUrl,
    normalizeText,
} from "#flows/musicDownloadFlow/musicbrainz/normalize";
import type {
    CheckResult,
    IdentityInput,
    MbArtistRef,
    MbRecording,
    MbRelease,
    MbSearchRelease,
} from "#flows/musicDownloadFlow/musicbrainz/types";

// ── Fixtures ─────────────────────────────────────────────────────────────────────────────

const ok = <T>(value: T): CheckResult<T> => ({ status: "ok", value });
const skipped = <T>(reason: string): CheckResult<T> => ({ status: "skipped", reason });
const failed = <T>(error: string): CheckResult<T> => ({ status: "failed", error });

const AURORA: MbArtistRef = { id: "artist-aurora", name: "Aurora Vale" };
const OTHER_AURORA: MbArtistRef = { id: "artist-other", name: "Aurora Vale", disambiguation: "UK folk singer" };

const release = (id: string, over: Partial<MbRelease> = {}): MbRelease => ({
    id,
    title: "Night Drive",
    artists: [AURORA],
    barcode: "5059000000017",
    trackCount: 9,
    releaseGroupId: `rg-${id}`,
    ...over,
});

const recording = (id: string, releases: MbRelease[], artists: MbArtistRef[] = [AURORA]): MbRecording => ({
    id,
    title: "Night Drive",
    artists,
    releases,
});

const ALBUM_URL = "https://open.spotify.com/album/2ANVost0y2y52ema1E9xAZ";

function input(over: Partial<IdentityInput> = {}): IdentityInput {
    return {
        album: {
            id: "2ANVost0y2y52ema1E9xAZ",
            name: "Night Drive",
            url: ALBUM_URL,
            barcode: "5059000000017",
            trackCount: 9,
            artists: [{ name: "Aurora Vale", url: "https://open.spotify.com/artist/aurora" }],
            tracks: [],
        },
        track: {
            name: "Night Drive",
            isrc: "FRT092400049",
            artists: [{ name: "Aurora Vale", url: "https://open.spotify.com/artist/aurora" }],
        },
        barcodeReleases: ok([]),
        urlReleases: ok([]),
        isrcRecordings: ok([]),
        searchReleases: ok([]),
        artistsByUrl: {},
        artistSearch: {},
        now: "2026-11-11T10:00:00.000Z",
        ...over,
    };
}

// ── Release tiers ────────────────────────────────────────────────────────────────────────

describe("resolveMusicBrainzIdentity — conclusive evidence", () => {
    test("same barcode and same track count → matched, with the release group", () => {
        const r = release("rel-1");
        const id = resolveMusicBrainzIdentity(input({ barcodeReleases: ok([r]) }));
        expect(id.verdict).toBe("matched");
        expect(id.decidedBy).toBe("auto");
        expect(id.release?.id).toBe("rel-1");
        expect(id.releaseGroupId).toBe("rg-rel-1");
        expect(id.candidates).toEqual([]);
    });

    test("a 12-digit UPC matches the same code stored as a 13-digit EAN", () => {
        const r = release("rel-1", { barcode: "0602445000019" });
        const id = resolveMusicBrainzIdentity(
            input({
                album: { ...input().album, barcode: "602445000019" },
                barcodeReleases: ok([r]),
            })
        );
        expect(id.verdict).toBe("matched");
    });

    test("a barcode search hit with a DIFFERENT barcode is not evidence", () => {
        const noise = release("rel-noise", { barcode: "5059999999999" });
        const id = resolveMusicBrainzIdentity(input({ barcodeReleases: ok([noise]) }));
        expect(id.verdict).toBe("notFound");
    });

    test("same barcode but a different track count is NOT conclusive: needs review", () => {
        const deluxe = release("rel-deluxe", { trackCount: 14 });
        const id = resolveMusicBrainzIdentity(input({ barcodeReleases: ok([deluxe]) }));
        expect(id.verdict).toBe("needsReview");
        expect(id.candidates.map((c) => c.release.id)).toEqual(["rel-deluxe"]);
        expect(id.release).toBeUndefined();
    });

    test("same barcode with an unknown provider track count is NOT conclusive either", () => {
        const r = release("rel-1");
        const id = resolveMusicBrainzIdentity(
            input({ album: { ...input().album, trackCount: undefined }, barcodeReleases: ok([r]) })
        );
        expect(id.verdict).toBe("needsReview");
    });

    test("the streaming album URL already linked on a release → matched", () => {
        const r = release("rel-url", { barcode: undefined, trackCount: undefined });
        const id = resolveMusicBrainzIdentity(input({ urlReleases: ok([r]) }));
        expect(id.verdict).toBe("matched");
        expect(id.release?.id).toBe("rel-url");
    });

    test("barcode and URL pointing at two different releases → needs review, never a pick", () => {
        const a = release("rel-a");
        const b = release("rel-b", { barcode: "5059000000099" });
        const id = resolveMusicBrainzIdentity(input({ barcodeReleases: ok([a]), urlReleases: ok([b]) }));
        expect(id.verdict).toBe("needsReview");
        expect(id.candidates.map((c) => c.release.id).sort()).toEqual(["rel-a", "rel-b"]);
    });

    test("barcode and URL agreeing on the same release count once", () => {
        const r = release("rel-1");
        const id = resolveMusicBrainzIdentity(input({ barcodeReleases: ok([r]), urlReleases: ok([r]) }));
        expect(id.verdict).toBe("matched");
        expect(id.evidence.length).toBeGreaterThanOrEqual(2);
    });

    test("two releases sharing the barcode and track count → needs review", () => {
        const a = release("rel-a");
        const b = release("rel-b");
        const id = resolveMusicBrainzIdentity(input({ barcodeReleases: ok([a, b]) }));
        expect(id.verdict).toBe("needsReview");
        expect(id.candidates).toHaveLength(2);
    });
});

describe("resolveMusicBrainzIdentity — the digital edition and the alternatives", () => {
    // The CD carries the barcode (the label reused it for the streaming release); the digital edition has none.
    const cd = release("rel-cd", { format: "CD", releaseGroupId: "rg-1", status: "Official", date: "2017-10-20" });
    const digital = release("rel-digital", {
        format: "Digital Media",
        barcode: undefined,
        releaseGroupId: "rg-1",
        status: "Official",
        date: "2017-10-20",
    });
    const group = (...releases: MbRelease[]) => ({ groupReleases: ok(releases) });

    test("matched through the CD's barcode: the one digital edition of its release group is chosen instead", () => {
        const id = resolveMusicBrainzIdentity(input({ barcodeReleases: ok([cd]), ...group(cd, digital) }));
        expect(id.verdict).toBe("matched");
        expect(id.decidedBy).toBe("auto");
        expect(id.release?.id).toBe("rel-digital");
        expect(id.releaseGroupId).toBe("rg-1");
        expect(id.evidence.join(" ")).toContain("digital edition");
        // The CD the identifiers pointed at is still there to pick.
        expect(id.alternatives?.map((a) => a.release.id)).toEqual(["rel-cd"]);
        expect(id.alternatives?.[0].evidence).toEqual(["barcode"]);
    });

    test("two digital editions are ambiguous: the choice stays with the identifiers, both are alternatives", () => {
        const digital2 = release("rel-digital-2", {
            format: "Digital Media",
            barcode: undefined,
            releaseGroupId: "rg-1",
        });
        const id = resolveMusicBrainzIdentity(input({ barcodeReleases: ok([cd]), ...group(cd, digital, digital2) }));
        expect(id.release?.id).toBe("rel-cd");
        expect(id.alternatives?.map((a) => a.release.id).sort()).toEqual(["rel-digital", "rel-digital-2"]);
    });

    test("a digital edition with another track count is another album, not this one", () => {
        const deluxe = release("rel-digital-deluxe", { format: "Digital Media", trackCount: 14, barcode: undefined });
        const id = resolveMusicBrainzIdentity(input({ barcodeReleases: ok([cd]), ...group(cd, deluxe) }));
        expect(id.release?.id).toBe("rel-cd");
    });

    test("a digital edition the user turned down is never picked", () => {
        const id = resolveMusicBrainzIdentity(
            input({
                barcodeReleases: ok([cd]),
                ...group(cd, digital),
                user: { rejectedReleaseIds: ["rel-digital"], artistChoices: {} },
            })
        );
        expect(id.release?.id).toBe("rel-cd");
        expect(id.alternatives?.map((a) => a.release.id)).toEqual([]);
    });

    test("without the group (the lookup failed, or none was asked) the match stands as the identifiers say", () => {
        for (const groupReleases of [failed<MbRelease[]>("503"), undefined]) {
            const id = resolveMusicBrainzIdentity(input({ barcodeReleases: ok([cd]), groupReleases }));
            expect(id.verdict).toBe("matched");
            expect(id.release?.id).toBe("rel-cd");
            expect(id.alternatives).toEqual([]);
        }
    });

    test("already digital: kept; the rest of the release group (official ones only) are the alternatives, digital first", () => {
        const bootleg = release("rel-boot", { format: "CD", status: "Bootleg", releaseGroupId: "rg-1" });
        const digitalXw = release("rel-xw", { format: "Digital Media", barcode: undefined, releaseGroupId: "rg-1" });
        const withBarcode = release("rel-digital-bc", { format: "Digital Media", releaseGroupId: "rg-1" });
        const id = resolveMusicBrainzIdentity(
            input({ urlReleases: ok([withBarcode]), ...group(cd, bootleg, withBarcode, digitalXw) })
        );
        expect(id.release?.id).toBe("rel-digital-bc");
        expect(id.alternatives?.map((a) => a.release.id)).toEqual(["rel-xw", "rel-cd"]);
        expect(id.alternatives?.[1].evidence).toEqual(["group"]);
    });

    test("the user's choice is never replaced by an edition, and the others are still listed", () => {
        const id = resolveMusicBrainzIdentity(
            input({
                barcodeReleases: ok([cd]),
                ...group(cd, digital),
                user: { chosenRelease: cd, rejectedReleaseIds: [], artistChoices: {} },
            })
        );
        expect(id).toMatchObject({ verdict: "matched", decidedBy: "user" });
        expect(id.release?.id).toBe("rel-cd");
        expect(id.alternatives?.map((a) => a.release.id)).toEqual(["rel-digital"]);
    });

    test("no alternatives are listed unless a release is matched", () => {
        const id = resolveMusicBrainzIdentity(
            input({ isrcRecordings: ok([recording("rec-1", [cd])]), ...group(cd, digital) })
        );
        expect(id.verdict).toBe("needsReview");
        expect(id.alternatives).toEqual([]);
    });
});

describe("resolveMusicBrainzIdentity — recording-level evidence", () => {
    test("ISRC on exactly one release with the album's title and track count → the user picks, never an automatic match", () => {
        const r = release("rel-1", { barcode: undefined });
        const id = resolveMusicBrainzIdentity(input({ isrcRecordings: ok([recording("rec-1", [r])]) }));
        expect(id.verdict).toBe("needsReview");
        expect(id.decidedBy).toBe("auto");
        expect(id.release).toBeUndefined();
        expect(id.candidates.map((c) => c.release.id)).toEqual(["rel-1"]);
        // The recording is still known (the ISRC names exactly one), the release is not.
        expect(id.recordingId).toBe("rec-1");
    });

    test("a search hit with the album's title and track count is a candidate only", () => {
        const r = release("rel-1", { barcode: undefined });
        const id = resolveMusicBrainzIdentity(input({ searchReleases: ok([{ ...r, score: 100 }]) }));
        expect(id.verdict).toBe("needsReview");
        expect(id.release).toBeUndefined();
    });

    test("ISRC on a compilation with another title and track count is not even a candidate", () => {
        const compilation = release("rel-comp", { title: "Best of 2024", trackCount: 20, barcode: undefined });
        const id = resolveMusicBrainzIdentity(input({ isrcRecordings: ok([recording("rec-1", [compilation])]) }));
        expect(id.verdict).toBe("notFound");
        expect(id.release).toBeUndefined();
    });

    test("ISRC on two fitting releases → needs review", () => {
        const a = release("rel-a", { barcode: undefined });
        const b = release("rel-b", { barcode: undefined });
        const id = resolveMusicBrainzIdentity(input({ isrcRecordings: ok([recording("rec-1", [a, b])]) }));
        expect(id.verdict).toBe("needsReview");
    });

    test("a recording that is not on the matched release is not attached to it", () => {
        const matched = release("rel-1");
        const elsewhere = release("rel-x", { title: "Other", trackCount: 3, barcode: undefined });
        const id = resolveMusicBrainzIdentity(
            input({ barcodeReleases: ok([matched]), isrcRecordings: ok([recording("rec-1", [elsewhere])]) })
        );
        expect(id.verdict).toBe("matched");
        expect(id.recordingId).toBeUndefined();
    });

    test("without a matched release a single ISRC recording is still reported", () => {
        const id = resolveMusicBrainzIdentity(
            input({
                isrcRecordings: ok([recording("rec-1", [])]),
            })
        );
        expect(id.verdict).toBe("notFound");
        expect(id.recordingId).toBe("rec-1");
    });

    test("two recordings for one ISRC give no recording id", () => {
        const id = resolveMusicBrainzIdentity(
            input({ isrcRecordings: ok([recording("rec-1", []), recording("rec-2", [])]) })
        );
        expect(id.recordingId).toBeUndefined();
    });
});

describe("resolveMusicBrainzIdentity — suggestive evidence", () => {
    const hit = (id: string, score: number, over: Partial<MbSearchRelease> = {}): MbSearchRelease => ({
        ...release(id, { barcode: undefined }),
        score,
        ...over,
    });

    test("a high-score search hit with the same title and track count is only a review candidate", () => {
        const id = resolveMusicBrainzIdentity(input({ searchReleases: ok([hit("rel-s", 97)]) }));
        expect(id.verdict).toBe("needsReview");
        expect(id.release).toBeUndefined();
    });

    test("a low score is ignored", () => {
        const id = resolveMusicBrainzIdentity(input({ searchReleases: ok([hit("rel-s", 80)]) }));
        expect(id.verdict).toBe("notFound");
    });

    test("a high score with a different track count is ignored", () => {
        const id = resolveMusicBrainzIdentity(input({ searchReleases: ok([hit("rel-s", 99, { trackCount: 3 })]) }));
        expect(id.verdict).toBe("notFound");
    });

    test("a high score with a different title is ignored", () => {
        const id = resolveMusicBrainzIdentity(
            input({ searchReleases: ok([hit("rel-s", 99, { title: "Day Drive" })]) })
        );
        expect(id.verdict).toBe("notFound");
    });
});

// ── Absence ──────────────────────────────────────────────────────────────────────────────

describe("resolveMusicBrainzIdentity — claiming a release is not there", () => {
    test("all four checks ran and found nothing → notFound", () => {
        const id = resolveMusicBrainzIdentity(input());
        expect(id.verdict).toBe("notFound");
        expect(id.checks.map((c) => c.status)).toEqual(["ok", "ok", "ok", "ok"]);
        expect(id.evidence[0]).toContain("none");
    });

    test.each([
        ["barcode", { barcodeReleases: skipped<MbRelease[]>("no barcode") }],
        ["url", { urlReleases: failed<MbRelease[]>("503") }],
        ["isrc", { isrcRecordings: skipped<MbRecording[]>("no ISRC") }],
        ["search", { searchReleases: failed<MbSearchRelease[]>("timeout") }],
    ] as const)("a %s check that could not run → unknown, never notFound", (_name, over) => {
        const id = resolveMusicBrainzIdentity(input(over));
        expect(id.verdict).toBe("unknown");
        expect(id.evidence.join(" ")).toMatch(/not checked|failed/);
    });

    test("a found release still wins over a failed check", () => {
        const id = resolveMusicBrainzIdentity(
            input({ barcodeReleases: ok([release("rel-1")]), searchReleases: failed("timeout") })
        );
        expect(id.verdict).toBe("matched");
    });
});

// ── User decisions ───────────────────────────────────────────────────────────────────────

describe("resolveMusicBrainzIdentity — what the user decided", () => {
    test("a chosen release is matched, decided by the user, even if it is no longer a candidate", () => {
        const chosen = release("rel-chosen");
        const id = resolveMusicBrainzIdentity(
            input({ user: { chosenRelease: chosen, rejectedReleaseIds: [], artistChoices: {} } })
        );
        expect(id.verdict).toBe("matched");
        expect(id.decidedBy).toBe("user");
        expect(id.release?.id).toBe("rel-chosen");
        expect(id.evidence).toContain("You chose this release");
    });

    test("rejected releases never come back, and the rest decides", () => {
        const deluxe = release("rel-deluxe", { trackCount: 14 });
        const id = resolveMusicBrainzIdentity(
            input({
                barcodeReleases: ok([deluxe]),
                user: { rejectedReleaseIds: ["rel-deluxe"], artistChoices: {} },
            })
        );
        expect(id.verdict).toBe("notFound");
        expect(id.decidedBy).toBe("user");
    });

    test("rejecting everything while a check could not run stays unknown", () => {
        const deluxe = release("rel-deluxe", { trackCount: 14 });
        const id = resolveMusicBrainzIdentity(
            input({
                barcodeReleases: ok([deluxe]),
                searchReleases: failed("timeout"),
                user: { rejectedReleaseIds: ["rel-deluxe"], artistChoices: {} },
            })
        );
        expect(id.verdict).toBe("unknown");
    });

    test("a release returned by the editor is accepted only with evidence", () => {
        const added = release("rel-new", { urls: [`${ALBUM_URL}?si=abc`] });
        const withEvidence = resolveMusicBrainzIdentity(input({ knownReleases: [added] }));
        expect(withEvidence.verdict).toBe("matched");
        expect(withEvidence.release?.id).toBe("rel-new");

        const stranger = release("rel-stranger", { barcode: "999", urls: ["https://example.com/x"] });
        const without = resolveMusicBrainzIdentity(input({ knownReleases: [stranger] }));
        expect(without.verdict).toBe("notFound");
    });
});

// ── Artists ──────────────────────────────────────────────────────────────────────────────

describe("resolveArtist", () => {
    const artist = { name: "Aurora Vale", url: "https://open.spotify.com/artist/aurora" };
    const key = normalizeUrl(artist.url);
    const base = { artistsByUrl: {}, artistSearch: {}, recordings: [] };

    test("the streaming artist page linked to exactly one MusicBrainz artist → linked by url", () => {
        const r = resolveArtist(artist, { ...base, artistsByUrl: { [key]: ok([AURORA]) } });
        expect(r).toMatchObject({ mbid: "artist-aurora", evidence: "url" });
    });

    test("one streaming page linked to two MusicBrainz artists → no link, both are candidates", () => {
        const r = resolveArtist(artist, { ...base, artistsByUrl: { [key]: ok([AURORA, OTHER_AURORA]) } });
        expect(r.mbid).toBeUndefined();
        expect(r.candidates.map((c) => c.id)).toEqual(["artist-aurora", "artist-other"]);
    });

    test("a same-name search hit alone is NEVER linked, only offered", () => {
        const r = resolveArtist(artist, {
            ...base,
            artistSearch: { [normalizeText(artist.name)]: ok([AURORA, OTHER_AURORA]) },
        });
        expect(r.mbid).toBeUndefined();
        expect(r.evidence).toBeUndefined();
        expect(r.candidates).toHaveLength(2);
    });

    test("the credit of a recording with the track's ISRC links the artist", () => {
        const r = resolveArtist(artist, { ...base, recordings: [recording("rec-1", [], [AURORA])] });
        expect(r).toMatchObject({ mbid: "artist-aurora", evidence: "isrc" });
    });

    test("two different same-name artists credited on ISRC recordings → ambiguous, not linked", () => {
        const r = resolveArtist(artist, {
            ...base,
            recordings: [recording("rec-1", [], [AURORA]), recording("rec-2", [], [OTHER_AURORA])],
        });
        expect(r.mbid).toBeUndefined();
        expect(r.candidates.map((c) => c.id).sort()).toEqual(["artist-aurora", "artist-other"]);
    });

    test("the credit of a release we are sure about links the artist", () => {
        const r = resolveArtist(artist, { ...base, release: release("rel-1") });
        expect(r).toMatchObject({ mbid: "artist-aurora", evidence: "release" });
    });

    test("the user's pick beats every other evidence; null means a new artist", () => {
        const key2 = `url:${normalizeUrl(artist.url)}`;
        const picked = resolveArtist(artist, {
            ...base,
            artistsByUrl: { [key]: ok([AURORA]) },
            user: { rejectedReleaseIds: [], artistChoices: { [key2]: "artist-other" } },
        });
        expect(picked).toMatchObject({ mbid: "artist-other", evidence: "user" });

        const fresh = resolveArtist(artist, {
            ...base,
            artistsByUrl: { [key]: ok([AURORA]) },
            user: { rejectedReleaseIds: [], artistChoices: { [key2]: null } },
        });
        expect(fresh.isNew).toBe(true);
        expect(fresh.mbid).toBeUndefined();
    });

    test("a failed lookup leaves the artist unresolved", () => {
        const r = resolveArtist(artist, { ...base, artistsByUrl: { [key]: failed("503") } });
        expect(r.mbid).toBeUndefined();
    });

    test("the identity carries one resolved artist per track artist", () => {
        const id = resolveMusicBrainzIdentity(
            input({ barcodeReleases: ok([release("rel-1")]), artistsByUrl: { [key]: ok([AURORA]) } })
        );
        expect(id.artists).toHaveLength(1);
        expect(id.artists[0]).toMatchObject({ mbid: "artist-aurora", evidence: "release" });
    });
});

// ── Normalisation ────────────────────────────────────────────────────────────────────────

describe("normalisation", () => {
    test("barcodes: digits only, no leading zeros", () => {
        expect(normalizeBarcode("0 602445 000019")).toBe("602445000019");
        expect(normalizeBarcode(undefined)).toBe("");
    });

    test("URLs: same album however it was copied", () => {
        const a = normalizeUrl("https://open.spotify.com/intl-fr/album/2ANV?si=QByTNuJ2");
        const b = normalizeUrl("http://www.open.spotify.com/album/2ANV/");
        expect(a).toBe(b);
        expect(canonicalUrl("https://open.spotify.com/intl-fr/album/2ANV?si=x")).toBe(
            "https://open.spotify.com/album/2ANV"
        );
    });

    test("text: accents, case and punctuation do not matter", () => {
        expect(normalizeText("Beyoncé — Halo!")).toBe("beyonce halo");
        expect(normalizeText("Simon & Garfunkel")).toBe("simon and garfunkel");
    });
});
