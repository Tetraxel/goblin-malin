import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { beforeAll, describe, expect, test } from "vitest";

// Importing the Spotify service resolves #constants: keep any data file it touches out of the developer's folder.
process.env.GOBLIN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-detect-test-"));

const { urlParserRegistry } = await import("#base/urlParser");
const { SpotifyService } = await import("#flows/musicDownloadFlow/services/metadata-providers/spotify/SpotifyService");
const { detectUrls } = await import("#components/ImportModal/detectUrls");

const TRACK = "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC";

beforeAll(() => {
    urlParserRegistry.register(SpotifyService.parseUrl);
    urlParserRegistry.registerNormalizer(SpotifyService.findLinks);
});

describe("detectUrls", () => {
    test("reads a plain URL once", () => {
        const found = detectUrls(`look: ${TRACK} nice`);
        expect(found.map((u) => u.raw)).toEqual([TRACK]);
        expect(found[0]).toMatchObject({ platform: "spotify", type: "track" });
    });

    test("accepts a link pasted without its scheme, and does not double count one that has it", () => {
        expect(detectUrls("open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC").map((u) => u.raw)).toEqual([TRACK]);
        expect(detectUrls("www.youtube.com/watch?v=abc").map((u) => u.raw)).toEqual([
            "https://www.youtube.com/watch?v=abc",
        ]);
        expect(detectUrls(TRACK)).toHaveLength(1);
    });

    test("accepts the URIs a service knows (spotify:track:<id>)", () => {
        const found = detectUrls("spotify:track:4uLU6hMCjMI75M1A2tKUQC\nspotify:album:1DFixLWuPkv3KT3TnV35m3");
        expect(found.map((u) => u.raw)).toEqual([TRACK, "https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3"]);
    });

    test("ignores text that merely looks dotted", () => {
        expect(detectUrls("see file.txt and v1.2.3 or john@example.com/x")).toEqual([]);
        expect(detectUrls("just some words")).toEqual([]);
    });
});
