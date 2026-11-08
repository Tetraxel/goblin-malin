import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeOutputPath, isOutputPathTaken } from "#flows/musicDownloadFlow/utils/computeOutputPath";
import type { CompiledMetadata } from "#flows/musicDownloadFlow/utils/compiledMetadata";

const compiled = { artists: [{ name: "Aki Oke" }], trackName: "don't you miss me" } as CompiledMetadata;

describe("computeOutputPath", () => {
    it("is the plain file name inside the folder", () => {
        expect(computeOutputPath(compiled, "out")).toBe(path.join("out", "Aki Oke - don't you miss me.flac"));
    });

    it("uses the name the user chose instead", () => {
        expect(computeOutputPath(compiled, "out", "Mine.flac")).toBe(path.join("out", "Mine.flac"));
    });

    it("never adds a (2) suffix, even when the name is taken", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-out-"));
        try {
            fs.writeFileSync(path.join(dir, "Aki Oke - don't you miss me.flac"), "");
            expect(path.basename(computeOutputPath(compiled, dir))).toBe("Aki Oke - don't you miss me.flac");
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe("isOutputPathTaken", () => {
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

    it("is free when nothing is there", () => {
        expect(isOutputPathTaken(path.join(dir, "a.flac"))).toBe(false);
    });

    it("is taken when another file has the name", () => {
        const file = touch("a.flac");
        expect(isOutputPathTaken(file)).toBe(true);
        expect(isOutputPathTaken(file, [undefined, path.join(dir, "b.flac")])).toBe(true);
    });

    it("does not count the track's own saved file", () => {
        const file = touch("a.flac");
        expect(isOutputPathTaken(file, [file])).toBe(false);
    });
});
