import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { readFlacTags, writeFlacTags } from "flac-tagger";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { buildFlacTagMap, cleanAndTagFlac, type Metadata } from "#utils/metadata";

/** The smallest stream flac-tagger accepts: the marker and a STREAMINFO block (no audio frames). */
const MINIMAL_FLAC = Buffer.concat([Buffer.from("fLaC"), Buffer.from([0x80, 0x00, 0x00, 0x22]), Buffer.alloc(34)]);

describe("buildFlacTagMap", () => {
    test("holds only the fields that have a value", () => {
        expect(buildFlacTagMap({ trackTitle: "T", artists: ["A", "B"] })).toEqual({
            TITLE: "T",
            ARTIST: ["A", "B"],
            ALBUMARTIST: ["A", "B"],
        });
        expect(buildFlacTagMap({ trackTitle: "T", artists: ["A"], albumName: "Alb", year: "2020", bpm: 0 })).toEqual({
            TITLE: "T",
            ARTIST: ["A"],
            ALBUMARTIST: ["A"],
            ALBUM: "Alb",
            YEAR: "2020",
            DATE: "2020",
            BPM: "0",
        });
    });

    test("the MusicBrainz ids go in under Picard's names: the recording is TRACKID, the release's track RELEASETRACKID", () => {
        expect(
            buildFlacTagMap({
                trackTitle: "T",
                artists: ["A"],
                musicBrainzTrackId: "rec",
                musicBrainzAlbumId: "rel",
                musicBrainzArtistId: "art",
                musicBrainzAlbumArtistIds: ["alb-1", "alb-2"],
                musicBrainzReleaseGroupId: "grp",
                musicBrainzReleaseTrackId: "trk",
            })
        ).toMatchObject({
            MUSICBRAINZ_TRACKID: "rec",
            MUSICBRAINZ_ALBUMID: "rel",
            MUSICBRAINZ_ARTISTID: "art",
            MUSICBRAINZ_ALBUMARTISTID: ["alb-1", "alb-2"],
            MUSICBRAINZ_RELEASEGROUPID: "grp",
            MUSICBRAINZ_RELEASETRACKID: "trk",
        });
    });
});

describe("cleanAndTagFlac — the app's tags replace the file's", () => {
    let dir: string;

    beforeAll(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-flac-replace-"));
    });

    afterAll(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test("a cleared field and the uploader's own tags do not survive a re-tag", async () => {
        const file = path.join(dir, "track.flac");
        fs.writeFileSync(file, MINIMAL_FLAC);
        await writeFlacTags(
            {
                tagMap: {
                    TITLE: "Old title",
                    ALBUM: "Old album",
                    DATE: "1999",
                    COMMENT: "Uploaded by someone",
                    ALBUM_ARTIST: "Someone",
                },
            },
            file
        );

        const metadata: Metadata = { trackTitle: "New title", artists: ["Artist"] };
        await cleanAndTagFlac(file, metadata);

        const tags = (await readFlacTags(file)).tagMap;
        const keys = Object.keys(tags).map((k) => k.toUpperCase());
        expect(keys.sort()).toEqual(["ALBUMARTIST", "ARTIST", "TITLE"]);
        expect(tags.TITLE ?? tags.title).toEqual("New title");
    });
});
