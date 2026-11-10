import { describe, test, expect } from "vitest";
import os from "os";
import path from "path";
import {
    cleanOutputDir,
    cleanOutputFilename,
    isSameDir,
    stripOutputExtension,
    withOutputExtension,
} from "#flows/musicDownloadFlow/utils/cleanOutputDir";

const isWin = process.platform === "win32";
// A folder that is absolute on every platform, written the way a user would paste it.
const dir = isWin ? "C:\\Users\\axel7\\Music\\Goblin Malin" : "/home/axel7/Music/Goblin Malin";

describe("cleanOutputDir", () => {
    test("leaves a clean folder untouched", () => {
        expect(cleanOutputDir(dir)).toBe(dir);
    });

    test("strips surrounding quotes and whitespace", () => {
        expect(cleanOutputDir(`  "${dir}"  `)).toBe(dir);
        expect(cleanOutputDir(`'${dir}'`)).toBe(dir);
        expect(cleanOutputDir(`“${dir}”`)).toBe(dir);
    });

    test("drops a trailing separator", () => {
        expect(cleanOutputDir(dir + path.sep)).toBe(dir);
        expect(cleanOutputDir(dir + path.sep + path.sep)).toBe(dir);
    });

    test("drops a trailing audio file name even when the file does not exist", () => {
        expect(cleanOutputDir(`"${path.join(dir, "Aki Oke - don't you miss me.flac")}"`)).toBe(dir);
        expect(cleanOutputDir(path.join(dir, "track.MP3"))).toBe(dir);
    });

    test("keeps a folder whose name merely contains a dot", () => {
        const dotted = path.join(dir, "Mixes v2.0");
        expect(cleanOutputDir(dotted)).toBe(dotted);
    });

    test("only uses the first non-empty line", () => {
        expect(cleanOutputDir(`\n\n${dir}\nsecond line`)).toBe(dir);
    });

    test("expands ~", () => {
        expect(cleanOutputDir("~/Music")).toBe(path.join(os.homedir(), "Music"));
    });

    test("rejects empty and relative input", () => {
        expect(cleanOutputDir("")).toBeNull();
        expect(cleanOutputDir('  ""  ')).toBeNull();
        expect(cleanOutputDir("Music/Goblin")).toBeNull();
    });

    test.runIf(isWin)("windows: forward slashes, drive roots and file:// links", () => {
        expect(cleanOutputDir("C:/Users/axel7/Music")).toBe("C:\\Users\\axel7\\Music");
        expect(cleanOutputDir("C:")).toBe("C:\\");
        expect(cleanOutputDir("C:\\")).toBe("C:\\");
        expect(cleanOutputDir("file:///C:/Users/axel7/Music/Goblin%20Malin")).toBe(
            "C:\\Users\\axel7\\Music\\Goblin Malin"
        );
    });

    test.runIf(!isWin)("posix: unescapes shell-escaped spaces", () => {
        expect(cleanOutputDir("/home/axel7/Music/Goblin\\ Malin")).toBe(dir);
    });
});

describe("isSameDir", () => {
    test("ignores a trailing separator", () => {
        expect(isSameDir(dir, dir + path.sep)).toBe(true);
    });

    test.runIf(isWin)("windows: ignores case", () => {
        expect(isSameDir("C:\\Music", "c:\\music")).toBe(true);
    });

    test("different folders differ", () => {
        expect(isSameDir(dir, path.join(dir, "sub"))).toBe(false);
    });
});

describe("cleanOutputFilename", () => {
    test("adds .flac to a bare name", () => {
        expect(cleanOutputFilename("Aki Oke - don't you miss me")).toBe("Aki Oke - don't you miss me.flac");
    });

    test("keeps a name that already ends in .flac, and swaps another audio extension", () => {
        expect(cleanOutputFilename("My Track.flac")).toBe("My Track.flac");
        expect(cleanOutputFilename("My Track.MP3")).toBe("My Track.flac");
        expect(cleanOutputFilename("Mix v2.0")).toBe("Mix v2.0.flac");
    });

    test("keeps only the last part of a pasted path, without quotes", () => {
        expect(cleanOutputFilename(`"${path.join(dir, "Some Track.flac")}"`)).toBe("Some Track.flac");
        expect(cleanOutputFilename("C:/Music/Some Track.flac")).toBe("Some Track.flac");
    });

    test("replaces characters a file name cannot hold and trailing dots", () => {
        expect(cleanOutputFilename("AC:DC - Who?")).toBe("AC_DC - Who_.flac");
        expect(cleanOutputFilename("Track...")).toBe("Track.flac");
    });

    test("uses the extension of the format the track is saved in", () => {
        expect(cleanOutputFilename("My Track", "mp3")).toBe("My Track.mp3");
        expect(cleanOutputFilename("My Track.flac", "opus")).toBe("My Track.opus");
        expect(cleanOutputFilename("Mix v2.0", "m4a")).toBe("Mix v2.0.m4a");
    });

    test("rejects what leaves no name", () => {
        expect(cleanOutputFilename("")).toBeNull();
        expect(cleanOutputFilename('  ""  ')).toBeNull();
        expect(cleanOutputFilename(".flac")).toBeNull();
        expect(cleanOutputFilename(dir + path.sep)).toBeNull();
    });
});

describe("stripOutputExtension", () => {
    test("removes the fixed extension, whatever its case", () => {
        expect(stripOutputExtension("Aki Oke - don't you miss me.flac")).toBe("Aki Oke - don't you miss me");
        expect(stripOutputExtension("Track.FLAC")).toBe("Track");
    });

    test("leaves a name without it alone", () => {
        expect(stripOutputExtension("Track")).toBe("Track");
        expect(stripOutputExtension("Track.mp3")).toBe("Track.mp3");
    });

    test("round-trips with cleanOutputFilename", () => {
        const name = cleanOutputFilename("My Mix v2.0")!;
        expect(stripOutputExtension(name)).toBe("My Mix v2.0");
    });

    test("removes the extension it is told, and only that one", () => {
        expect(stripOutputExtension("Track.mp3", "mp3")).toBe("Track");
        expect(stripOutputExtension("Track.flac", "mp3")).toBe("Track.flac");
        const name = cleanOutputFilename("My Mix v2.0", "opus")!;
        expect(stripOutputExtension(name, "opus")).toBe("My Mix v2.0");
    });
});

describe("withOutputExtension", () => {
    test("swaps the audio extension a name ends with", () => {
        expect(withOutputExtension("Track.flac", "mp3")).toBe("Track.mp3");
        expect(withOutputExtension("Track.OPUS", "flac")).toBe("Track.flac");
    });

    test("keeps a dot that is not an audio extension", () => {
        expect(withOutputExtension("Mix v2.0", "flac")).toBe("Mix v2.0.flac");
        expect(withOutputExtension("Track", "ogg")).toBe("Track.ogg");
    });
});
