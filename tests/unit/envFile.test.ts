import * as fs from "fs";
import * as os from "os";
import * as path from "path";
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
