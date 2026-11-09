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
