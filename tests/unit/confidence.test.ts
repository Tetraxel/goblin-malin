import { describe, test, expect } from "vitest";
import { computeConfidenceScore } from "#flows/musicDownloadFlow/utils/confidence";
import type { TrackMetadata } from "#flows/musicDownloadFlow/types";

function track(
    trackName: string,
    artist: string,
    opts: { duration?: number; year?: string; album?: string; isrc?: string } = {}
): TrackMetadata {
    return {
        id: "x",
        url: "https://example.com/x",
        trackName,
        artists: [{ type: "artist", name: artist }],
        duration: opts.duration,
        isrc: opts.isrc,
        album:
            opts.year || opts.album
                ? {
                      id: "a",
                      url: "https://example.com/a",
                      uri: "A",
                      albumName: opts.album ?? "",
                      releaseDate: opts.year,
                  }
                : undefined,
    } as unknown as TrackMetadata;
}

describe("computeConfidenceScore — non-Latin scripts", () => {
    test("identical Cyrillic track scores high", () => {
        const a = track("Группа крови", "Кино", { duration: 285000 });
        expect(computeConfidenceScore(a, a)).toBeGreaterThanOrEqual(90);
    });

    test("different Cyrillic title + artist does not score like an exact match", () => {
        const a = track("Группа крови", "Кино", { duration: 285000 });
        const b = track("Белые розы", "Ласковый май", { duration: 285000 });
        expect(computeConfidenceScore(b, a)).toBeLessThan(50);
    });

    test("identical Japanese track scores high, a different one does not", () => {
        const a = track("夜に駆ける", "YOASOBI", { duration: 258000 });
        const same = track("夜に駆ける", "YOASOBI", { duration: 258000 });
        const other = track("残酷な天使のテーゼ", "高橋洋子", { duration: 258000 });
        expect(computeConfidenceScore(same, a)).toBeGreaterThanOrEqual(90);
        expect(computeConfidenceScore(other, a)).toBeLessThan(50);
    });

    test("Greek and Korean letters are kept", () => {
        const g = track("Αγάπη", "Νότης Σφακιανάκης", { duration: 200000 });
        const g2 = track("Φεύγω", "Άλκηστις Πρωτοψάλτη", { duration: 200000 });
        expect(computeConfidenceScore(g, g)).toBeGreaterThanOrEqual(90);
        expect(computeConfidenceScore(g2, g)).toBeLessThan(50);
        const k = track("봄날", "BTS", { year: "2017-02-13" });
        expect(computeConfidenceScore(k, k)).toBeGreaterThanOrEqual(50);
    });

    test("a name that normalises to nothing is no information, not an exact match", () => {
        const a = track("!!!", "???", { duration: 100000 });
        const b = track("...", "---", { duration: 100000 });
        // only the duration (20) can count
        expect(computeConfidenceScore(b, a)).toBe(20);
    });
});

describe("computeConfidenceScore — accents", () => {
    test("accented and unaccented spellings match exactly", () => {
        const a = track("Halo", "Beyoncé", { duration: 261000 });
        const b = track("Halo", "Beyonce", { duration: 261000 });
        expect(computeConfidenceScore(b, a)).toBe(90);
    });
});

describe("computeConfidenceScore — versions", () => {
    const original = track("Song", "Artist", { duration: 200000 });

    test("same title and artist, same duration → 90", () => {
        expect(computeConfidenceScore(track("Song", "Artist", { duration: 200000 }), original)).toBe(90);
    });

    test("live / karaoke / cover / remix versions are penalised", () => {
        const base = computeConfidenceScore(track("Song", "Artist", { duration: 200000 }), original);
        for (const title of ["Song (Live)", "Song - Karaoke Version", "Song (Cover)", "Song (Remix)"]) {
            expect(computeConfidenceScore(track(title, "Artist", { duration: 200000 }), original)).toBeLessThan(base);
        }
    });

    test("both sides being live is not penalised", () => {
        const live = track("Song (Live)", "Artist", { duration: 200000 });
        expect(computeConfidenceScore(live, live)).toBe(90);
    });

    test("ISRC match short-circuits to 100", () => {
        const a = track("Song", "Artist", { isrc: "USABC1234567" });
        const b = track("Totally different", "Someone", { isrc: "USABC1234567" });
        expect(computeConfidenceScore(b, a)).toBe(100);
    });
});

describe("computeConfidenceScore — 'Artist - Title' uploads", () => {
    // An unofficial YouTube re-upload: the artist is only in the title, the channel is "the artist".
    const repost = track("Orelsan - Dans ma ville on traine (clip non officiel)", "Paul LATOUR", { duration: 242000 });
    const official = track("Dans ma ville on traine", "Orelsan", { duration: 242000 });

    test("the official track of a re-upload clears the last-resort bar (50) — it used to score 45", () => {
        // title contained (25) + artist found in the upload's title (15) + same duration (20)
        expect(computeConfidenceScore(official, repost)).toBe(60);
    });

    test("it works both ways: the official track as the primary and the upload as the candidate", () => {
        expect(computeConfidenceScore(repost, official)).toBe(60);
    });

    test("another artist's cover of the same title does NOT get the boost", () => {
        const cover = track("Dans ma ville on traine", "Jean Dupont", { duration: 242000 });
        expect(computeConfidenceScore(cover, repost)).toBe(45);
    });

    test("the artist has to be a whole word of the title, not part of one", () => {
        const upload = track("Orelsanfan - Dans ma ville on traine", "Some Channel", { duration: 242000 });
        const other = track("Dans ma ville on traine", "Orelsan", { duration: 242000 });
        expect(computeConfidenceScore(other, upload)).toBe(45);
    });

    test("an exact artist match still counts for the full 30", () => {
        const a = track("Song", "Artist", { duration: 200000 });
        expect(computeConfidenceScore(a, a)).toBe(90);
    });

    test("one-letter artist names never match inside a title", () => {
        const upload = track("A - Some Song", "Xyz Ltd", { duration: 200000 });
        const other = track("Some Song", "A", { duration: 200000 });
        expect(computeConfidenceScore(other, upload)).toBe(45);
    });
});
