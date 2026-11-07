import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeOutputPath } from "#flows/musicDownloadFlow/utils/computeOutputPath";
import type { CompiledMetadata } from "#flows/musicDownloadFlow/utils/compiledMetadata";

const compiled = { artists: [{ name: "Aki Oke" }], trackName: "don't you miss me" } as CompiledMetadata;

describe("computeOutputPath", () => {
    let dir: string;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-out-"));
    });
    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    const touch = (name: string) => {
        const file = path.join(dir, name);
        fs.writeFileSync(file, "");
        return file;
    };

    it("uses the plain name when it is free", () => {
        expect(path.basename(computeOutputPath(compiled, dir))).toBe("Aki Oke - don't you miss me.flac");
    });

    it("adds (2) when another file has the name", () => {
        touch("Aki Oke - don't you miss me.flac");
        expect(path.basename(computeOutputPath(compiled, dir))).toBe("Aki Oke - don't you miss me (2).flac");
    });

    it("does not count the track's own saved file as taken", () => {
        const own = touch("Aki Oke - don't you miss me.flac");
        expect(computeOutputPath(compiled, dir, [own])).toBe(own);
    });

    it("does not count a file that is about to be replaced as taken", () => {
        touch("Aki Oke - don't you miss me.flac");
        const replaced = touch("Aki Oke - don't you miss me (2).flac");
        // The plain name belongs to another file, so the replaced file's own name is the one reused.
        expect(computeOutputPath(compiled, dir, [undefined, replaced])).toBe(replaced);
    });
});
