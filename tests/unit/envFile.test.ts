import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import dotenv from "dotenv";
import { afterAll, beforeEach, describe, expect, test } from "vitest";

// `envFile` writes `<GOBLIN_DATA_DIR>/.env`, resolved when #constants loads.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-envfile-test-"));
process.env.GOBLIN_DATA_DIR = dataDir;
const { saveEnvVar, removeEnvVar, removeEnvVars, saveEnvVarsGroup } = await import("#utils/envFile");

const envPath = path.join(dataDir, ".env");
const read = () => fs.readFileSync(envPath, "utf-8");
const write = (text: string) => fs.writeFileSync(envPath, text, "utf-8");

afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));
beforeEach(() => fs.rmSync(envPath, { force: true }));

describe("saveEnvVar", () => {
    test("creates the file when there is none", async () => {
        await saveEnvVar("SPOTIFY_CLIENT_ID", "abc");
        expect(read()).toBe("SPOTIFY_CLIENT_ID=abc\n");
    });

    test("appends a new key and keeps everything already there", async () => {
        write("# my secrets\nA=1\n");
        await saveEnvVar("B", "2");
        expect(read()).toBe("# my secrets\nA=1\nB=2\n");
    });

    test("replaces an existing key in place, whatever its case, and touches no other line", async () => {
        write("A=1\nspotify_client_id=old\nC=3\n");
        await saveEnvVar("SPOTIFY_CLIENT_ID", "new");
        expect(read()).toBe("A=1\nSPOTIFY_CLIENT_ID=new\nC=3\n");
    });

    test("does not mistake a key that merely starts with the same letters", async () => {
        write("SPOTIFY_CLIENT_ID_OLD=1\n");
        await saveEnvVar("SPOTIFY_CLIENT_ID", "2");
        expect(read()).toBe("SPOTIFY_CLIENT_ID_OLD=1\nSPOTIFY_CLIENT_ID=2\n");
    });

    test("finds the key in a file with Windows line endings", async () => {
        write("A=1\r\nB=2\r\n");
        await saveEnvVar("B", "3");
        expect(read()).toContain("B=3");
        expect(read()).not.toContain("B=2");
        expect(read().match(/^B=/gm)).toHaveLength(1);
    });
});

describe("removeEnvVar", () => {
    test("removes the key and collapses the blank line it leaves behind", async () => {
        write("A=1\n\nB=2\n\nC=3\n");
        await removeEnvVar("B");
        expect(read()).toBe("A=1\n\nC=3\n");
    });

    test("is harmless when the file or the key does not exist", async () => {
        await removeEnvVar("NOPE");
        expect(read()).toBe("");
        write("A=1\n");
        await removeEnvVar("NOPE");
        expect(read()).toBe("A=1\n");
    });
});

describe("removeEnvVars", () => {
    test("removes every listed key", async () => {
        write("A=1\nB=2\nC=3\n");
        await removeEnvVars(["A", "C"]);
        expect(read().trim()).toBe("B=2");
    });

    test("drops the group header once none of the group's variables remain", async () => {
        write("# Spotify - https://x\nSPOTIFY_ID=1\nSPOTIFY_SECRET=2\n\n# Soulseek\nSLSK_USER=u\n");
        await removeEnvVars(["SPOTIFY_ID", "SPOTIFY_SECRET"], { name: "Spotify" });
        expect(read().trim()).toBe("# Soulseek\nSLSK_USER=u");
    });

    test("keeps the group header while one of its variables is still there", async () => {
        write("# Spotify - https://x\nSPOTIFY_ID=1\nSPOTIFY_SECRET=2\n");
        await removeEnvVars(["SPOTIFY_ID"], { name: "Spotify" });
        expect(read().trim()).toBe("# Spotify - https://x\nSPOTIFY_SECRET=2");
    });
});

describe("saveEnvVarsGroup", () => {
    const spotify = { name: "Spotify", url: "https://developer.spotify.com" };

    test("appends a new labelled section at the end", async () => {
        write("A=1\n");
        await saveEnvVarsGroup({ SPOTIFY_ID: "1", SPOTIFY_SECRET: "2" }, spotify);
        expect(read()).toBe("A=1\n\n# Spotify - https://developer.spotify.com\nSPOTIFY_ID=1\nSPOTIFY_SECRET=2\n");
    });

    test("creates the file with just the section when there is none", async () => {
        await saveEnvVarsGroup({ SPOTIFY_ID: "1" }, { name: "Spotify" });
        expect(read().trim()).toBe("# Spotify\nSPOTIFY_ID=1");
    });

    test("pulls a key from wherever it was into the group, without duplicating it", async () => {
        write("SPOTIFY_ID=old\nA=1\n\n# Spotify - https://developer.spotify.com\nSPOTIFY_SECRET=s\n");
        await saveEnvVarsGroup({ SPOTIFY_ID: "new" }, spotify);
        const lines = read().split("\n");
        expect(lines.filter((l) => l.startsWith("SPOTIFY_ID="))).toEqual(["SPOTIFY_ID=new"]);
        const header = lines.indexOf("# Spotify - https://developer.spotify.com");
        expect(lines.slice(header + 1, header + 3).sort()).toEqual(["SPOTIFY_ID=new", "SPOTIFY_SECRET=s"]);
        expect(lines).toContain("A=1");
    });

    test("writes nothing when every value is blank (the file is not even created)", async () => {
        await saveEnvVarsGroup({ SPOTIFY_ID: "  ", SPOTIFY_SECRET: "" }, spotify);
        expect(fs.existsSync(envPath)).toBe(false);
    });

    test("a blank value leaves the existing key alone", async () => {
        write("# Spotify\nSPOTIFY_ID=keep\n");
        await saveEnvVarsGroup({ SPOTIFY_ID: "", SPOTIFY_SECRET: "2" }, { name: "Spotify" });
        expect(read()).toContain("SPOTIFY_ID=keep");
        expect(read()).toContain("SPOTIFY_SECRET=2");
    });
});

describe("writing the file", () => {
    test.skipIf(process.platform === "win32")("the file is readable by its owner alone", async () => {
        await saveEnvVar("SECRET", "x");
        expect(fs.statSync(envPath).mode & 0o777).toBe(0o600);
        await saveEnvVar("SECRET", "y");
        expect(fs.statSync(envPath).mode & 0o777).toBe(0o600);
    });

    test("nothing is left beside it (the write goes through a staging file)", async () => {
        await saveEnvVar("A", "1");
        await removeEnvVar("A");
        await saveEnvVarsGroup({ B: "2" }, { name: "Group" });
        expect(fs.readdirSync(dataDir).filter((n) => n.startsWith(".env"))).toEqual([".env"]);
    });

    test("saves started together all land (each one reads the file the previous one wrote)", async () => {
        const keys = Array.from({ length: 25 }, (_, i) => `KEY_${i}`);
        await Promise.all(keys.map((key) => saveEnvVar(key, `value ${key}`)));
        const parsed = dotenv.parse(read());
        for (const key of keys) expect(parsed[key]).toBe(`value ${key}`);
    });

    test("a save that fails does not stop the ones after it", async () => {
        const failing = saveEnvVar("BAD", "line1\nline2");
        const fine = saveEnvVar("GOOD", "1");
        await expect(failing).rejects.toThrow();
        await fine;
        expect(dotenv.parse(read())).toEqual({ GOOD: "1" });
    });

    test("a key with regular-expression characters matches itself only", async () => {
        write("A.B=1\nAXB=2\n");
        await saveEnvVar("A.B", "3");
        expect(dotenv.parse(read())).toEqual({ "A.B": "3", AXB: "2" });
        await removeEnvVar("A.B");
        expect(dotenv.parse(read())).toEqual({ AXB: "2" });
    });
});

// What the user types in a setup wizard must be what the app reads at the next launch (dotenv is what reads it).
describe("a value survives the trip to disk and back", () => {
    const hostile = [
        "abc#123",
        "p@ss #word",
        '"quoted"',
        "it's",
        "  padded  ",
        "`x`",
        "back\\slash",
        // dotenv turns these two characters into a line break inside double quotes
        "C:\\new",
        "a\\rb",
        "it's C:\\new",
        'mixed "double" and `back`',
        "with=equals and $dollar",
        "plain",
        "A1b2-C3_d4.e5/f6+g7==",
    ];

    test.each(hostile)("saveEnvVar: %j", async (value) => {
        await saveEnvVar("SECRET", value);
        expect(dotenv.parse(read()).SECRET).toBe(value);
    });

    test("saveEnvVarsGroup, next to other variables", async () => {
        write("BEFORE=1\n");
        await saveEnvVarsGroup({ A: "x#y", B: ' "q" ' }, { name: "Group" });
        const parsed = dotenv.parse(read());
        expect(parsed).toMatchObject({ BEFORE: "1", A: "x#y", B: ' "q" ' });
    });

    test("replacing a value keeps the others intact", async () => {
        await saveEnvVar("FIRST", "a b");
        await saveEnvVar("SECOND", "c#d");
        await saveEnvVar("FIRST", "e f");
        expect(dotenv.parse(read())).toEqual({ FIRST: "e f", SECOND: "c#d" });
    });

    test("a value that is a plain word is written as it is", async () => {
        await saveEnvVar("SPOTIFY_CLIENT_ID", "abc123");
        expect(read()).toBe("SPOTIFY_CLIENT_ID=abc123\n");
    });

    test("a line break is refused, not turned into a second variable", async () => {
        await expect(saveEnvVar("SECRET", "line1\nINJECTED=1")).rejects.toThrow(/line break/);
        expect(fs.existsSync(envPath)).toBe(false);
    });

    test("a value holding all three kinds of quote is refused", async () => {
        await expect(saveEnvVar("SECRET", "\"'`")).rejects.toThrow(/cannot be saved/);
    });

    test("a value with a quote of each kind but no backslash-n is still saved", async () => {
        // Only a single quote and a backtick are out of the question here; the double quote would be the wrapper.
        await saveEnvVar("SECRET", "it's `x`");
        expect(dotenv.parse(read()).SECRET).toBe("it's `x`");
    });

    test("a value that no quote can hold faithfully is refused, not corrupted", async () => {
        await expect(saveEnvVar("SECRET", "it's `x` C:\\new")).rejects.toThrow(/cannot be saved/);
    });
});
