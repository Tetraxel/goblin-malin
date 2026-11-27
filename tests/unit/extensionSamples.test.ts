import { describe, expect, test } from "vitest";
// The sample extensions (examples/extensions/) are plain JavaScript: their pure parts are tested here.
// @ts-expect-error -- a plain .js file of an example, no types
import { findOwned, normalise } from "../../examples/extensions/library-dedupe/match.js";
// @ts-expect-error -- a plain .js file of an example, no types
import { expandCommand, quote } from "../../examples/extensions/after-save-command/command.js";

describe("library-dedupe: matching the list against a library", () => {
    const tracks = [
        { id: "a", title: "Song (Remastered 2011)", artists: ["Beyoncé"], durationMs: 200_000 },
        { id: "b", title: "Other", artists: ["X"], isrc: "fr-t09-24-00049" },
        { id: "c", title: "Song", artists: ["Beyonce"], durationMs: 260_000 },
        { id: "d", title: "Unknown", artists: ["Nobody"] },
    ];
    const files = [
        { path: "/lib/song.flac", title: "Song", artists: ["Beyonce feat. Jay-Z"], durationMs: 201_500 },
        { path: "/lib/other.mp3", title: "Something else", artists: ["Y"], isrc: "FRT092400049" },
    ];

    test("by ISRC first, else by artist + title with durations within 3 s", () => {
        expect(findOwned(tracks, files)).toEqual([
            { trackId: "a", file: "/lib/song.flac", by: "name" },
            { trackId: "b", file: "/lib/other.mp3", by: "isrc" },
        ]);
    });

    test("without the duration check, a different length still matches by name", () => {
        expect(findOwned(tracks, files, { useDuration: false }).map((m: { trackId: string }) => m.trackId)).toEqual([
            "a",
            "b",
            "c",
        ]);
    });

    test("normalising drops accents, noise in brackets and featured artists", () => {
        expect(normalise("Beyoncé feat. Jay-Z")).toBe("beyonce");
        expect(normalise("Halo (Official Video)")).toBe("halo");
        expect(normalise("Rock & Roll")).toBe("rock and roll");
    });
});

describe("after-save-command: building the command line", () => {
    test("each placeholder becomes one quoted argument, whatever it holds", () => {
        expect(expandCommand("beet import -q {path}", { path: "/m/Don't Stop.flac" }, "linux")).toBe(
            `beet import -q '/m/Don'\\''t Stop.flac'`
        );
        expect(expandCommand("echo {title} {nope}", { title: 'Say "hi"' }, "win32")).toBe(`echo "Say ""hi""" {nope}`);
        expect(quote("$(rm -rf ~)", "linux")).toBe("'$(rm -rf ~)'");
    });
});
