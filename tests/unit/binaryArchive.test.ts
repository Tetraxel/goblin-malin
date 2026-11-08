import * as fs from "fs/promises";
import * as http from "http";
import type { AddressInfo } from "net";
import * as os from "os";
import * as path from "path";
import AdmZip from "adm-zip";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

let binDir: string;
vi.mock("#utils/appPaths", () => ({ getBinDir: () => binDir }));
vi.mock("#base/logger/logger", () => ({
    globalLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { installFromZip } from "#utils/binaryArchive";

const zip = new AdmZip();
zip.addFile("ffmpeg-master/bin/ffmpeg.exe", Buffer.from("FFMPEG"));
zip.addFile("ffmpeg-master/bin/ffprobe.exe", Buffer.from("FFPROBE"));
const zipBuffer = zip.toBuffer();

let server: http.Server;
let base: string;
let archiveRequests = 0;
let tmp: string;
let checksumLine = "";

beforeAll(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "gm-archive-"));
    server = http.createServer((req, res) => {
        if (req.url === "/a.zip") {
            archiveRequests++;
            // slow enough for two callers to overlap
            setTimeout(() => res.writeHead(200).end(zipBuffer), 50);
        } else if (req.url === "/sums") {
            res.writeHead(200).end(checksumLine);
        } else {
            res.writeHead(404).end();
        }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(tmp, { recursive: true, force: true });
});
beforeEach(async () => {
    binDir = await fs.mkdtemp(path.join(tmp, "bin-"));
    archiveRequests = 0;
    checksumLine = "";
});

const targets = () => [
    { entrySuffix: "bin/ffmpeg.exe", destPath: path.join(binDir, "ffmpeg_1.exe") },
    { entrySuffix: "bin/ffprobe.exe", destPath: path.join(binDir, "ffprobe_1.exe") },
];
const source = (extra = {}) => ({ url: `${base}/a.zip`, tempName: "ffmpeg-download.zip", userAgent: "t", ...extra });

describe("installFromZip (DL-01)", () => {
    test("two callers for the same archive share one download and both binaries appear", async () => {
        await Promise.all([installFromZip(source(), targets()), installFromZip(source(), targets())]);
        expect(archiveRequests).toBe(1);
        expect(await fs.readFile(path.join(binDir, "ffmpeg_1.exe"), "utf8")).toBe("FFMPEG");
        expect(await fs.readFile(path.join(binDir, "ffprobe_1.exe"), "utf8")).toBe("FFPROBE");
        expect(await fs.readdir(binDir)).toEqual(["ffmpeg_1.exe", "ffprobe_1.exe"]); // zip removed
    });

    test("an entry missing from the archive fails and leaves no zip behind", async () => {
        await expect(
            installFromZip(source(), [{ entrySuffix: "bin/nope.exe", destPath: path.join(binDir, "nope_1.exe") }])
        ).rejects.toThrow(/not found in the downloaded archive/);
        expect(await fs.readdir(binDir)).toEqual([]);
    });

    test("a published checksum that does not match aborts the install", async () => {
        checksumLine = `${"0".repeat(64)}  a.zip\n`;
        await expect(
            installFromZip(source({ checksumsUrl: `${base}/sums`, archiveName: "a.zip" }), targets())
        ).rejects.toThrow(/does not match/);
        expect(await fs.readdir(binDir)).toEqual([]);
    });

    test("an unreachable checksum list does not stop the install", async () => {
        await installFromZip(source({ checksumsUrl: `${base}/missing`, archiveName: "a.zip" }), targets());
        expect(await fs.readdir(binDir)).toEqual(["ffmpeg_1.exe", "ffprobe_1.exe"]);
    });
});
