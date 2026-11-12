import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { tagAudioFile } from "#flows/musicDownloadFlow/utils/tagAudioFile";
import { readTags } from "#flows/musicDownloadFlow/utils/readFileInfo";
import { MUSICBRAINZ_TAG_FIELDS, hasMusicBrainzTags } from "#flows/musicDownloadFlow/utils/musicBrainzTagFields";
import { tagValue } from "#components/SecondaryPanel/DownloadPanel/utils";
import type { Metadata } from "#utils/metadata";

/** The smallest stream flac-tagger accepts: the marker and a STREAMINFO block (no audio frames). */
const MINIMAL_FLAC = Buffer.concat([Buffer.from("fLaC"), Buffer.from([0x80, 0x00, 0x00, 0x22]), Buffer.alloc(34)]);

const withIds: Metadata = {
    trackTitle: "Night Drive",
    artists: ["Aurora Vale"],
    musicBrainzTrackId: "rec-1",
    musicBrainzAlbumId: "rel-1",
    musicBrainzArtistId: "art-1",
    musicBrainzAlbumArtistIds: ["alb-art-1"],
    musicBrainzReleaseGroupId: "grp-1",
    musicBrainzReleaseTrackId: "trk-1",
};

/** What the file panel shows for every MusicBrainz row. */
const shown = (tags: Record<string, string | string[]>) =>
    Object.fromEntries(MUSICBRAINZ_TAG_FIELDS.map((f) => [f.label, tagValue(tags, f.tag)]));

describe("the MusicBrainz ids written into a file are read back for the panel", () => {
    let dir: string;
    beforeAll(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-mb-tags-"));
    });
    afterAll(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    const expected = {
        Recording: "rec-1",
        Release: "rel-1",
        Artist: "art-1",
        "Alb. artist": "alb-art-1",
        Group: "grp-1",
        Track: "trk-1",
    };

    test("FLAC: all six, with Picard's names", async () => {
        const file = path.join(dir, "a.flac");
        fs.writeFileSync(file, MINIMAL_FLAC);
        await tagAudioFile(file, withIds);
        const tags = await readTags(file, "flac");
        expect(hasMusicBrainzTags(tags)).toBe(true);
        expect(shown(tags)).toEqual(expected);
    });

    test("FLAC: written without them, the file has none", async () => {
        const file = path.join(dir, "b.flac");
        fs.writeFileSync(file, MINIMAL_FLAC);
        await tagAudioFile(file, { trackTitle: "Night Drive", artists: ["Aurora Vale"] });
        const tags = await readTags(file, "flac");
        expect(hasMusicBrainzTags(tags)).toBe(false);
        expect(Object.values(shown(tags)).every((v) => v === "—")).toBe(true);
    });

    test("MP3: all six, from the UFID and TXXX frames", async () => {
        const file = path.join(dir, "c.mp3");
        fs.writeFileSync(file, Buffer.alloc(64));
        await tagAudioFile(file, withIds);
        expect(shown(await readTags(file, "mp3"))).toEqual(expected);
    });
});
