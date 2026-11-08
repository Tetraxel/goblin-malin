import * as fs from "fs/promises";
import * as http from "http";
import type { AddressInfo } from "net";
import * as os from "os";
import * as path from "path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { downloadFile, HttpError, httpsGetJson } from "#utils/http";

/**
 * A real (loopback) HTTP server stands in for GitHub, so the redirect handling is tested
 * on actual sockets with no network and no mocks. Regression test for DL-01: GitHub moved
 * the ffmpeg repository and answered `301`, which the old code never followed.
 */
let server: http.Server;
let base: string;
let tmp: string;

beforeAll(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "gm-http-"));
    server = http.createServer((req, res) => {
        switch (req.url) {
            case "/moved":
                res.writeHead(301, { Location: "/release.json" }).end();
                break;
            case "/moved-twice":
                res.writeHead(302, { Location: "/moved" }).end();
                break;
            case "/release.json":
                res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ tag_name: "latest" }));
                break;
            case "/loop":
                res.writeHead(301, { Location: "/loop" }).end();
                break;
            case "/not-json":
                res.writeHead(200).end("<html>oops</html>");
                break;
            case "/gone":
                res.writeHead(404).end("nope");
                break;
            case "/file-moved":
                res.writeHead(308, { Location: "/file.bin" }).end();
                break;
            case "/file.bin":
                res.writeHead(200, { "Content-Length": "5" }).end("hello");
                break;
            case "/truncated":
                // Promises 100 bytes, sends 3, then drops the connection.
                res.writeHead(200, { "Content-Length": "100" });
                res.write("abc");
                setTimeout(() => res.destroy(), 20);
                break;
            case "/stall":
                res.writeHead(200, { "Content-Type": "application/json" });
                res.write("{"); // and never finish
                break;
            default:
                res.writeHead(500).end();
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

describe("httpsGetJson", () => {
    test("parses a plain 200 response", async () => {
        await expect(httpsGetJson(`${base}/release.json`)).resolves.toEqual({ tag_name: "latest" });
    });

    test("follows a 301 (the moved GitHub repository)", async () => {
        await expect(httpsGetJson(`${base}/moved`)).resolves.toEqual({ tag_name: "latest" });
    });

    test("follows several hops", async () => {
        await expect(httpsGetJson(`${base}/moved-twice`)).resolves.toEqual({ tag_name: "latest" });
    });

    test("gives up on a redirect loop instead of spinning forever", async () => {
        await expect(httpsGetJson(`${base}/loop`)).rejects.toThrow(/Too many redirects/);
    });

    test("rejects a non-200 answer with the URL and the status in the message", async () => {
        const error = await httpsGetJson(`${base}/gone`).catch((e) => e);
        expect(error).toBeInstanceOf(HttpError);
        expect(error.status).toBe(404);
        expect(error.message).toContain("404");
        expect(error.message).toContain(`${base}/gone`);
    });

    test("rejects a body that is not JSON, naming the URL", async () => {
        await expect(httpsGetJson(`${base}/not-json`)).rejects.toThrow(/not valid JSON/);
    });

    test("times out on a server that stops answering", async () => {
        await expect(httpsGetJson(`${base}/stall`, { timeoutMs: 100 })).rejects.toThrow();
    });
});

describe("downloadFile", () => {
    test("follows a redirect and writes the file", async () => {
        const dest = path.join(tmp, "ok.bin");
        await downloadFile(`${base}/file-moved`, dest);
        expect(await fs.readFile(dest, "utf8")).toBe("hello");
    });

    test("leaves no file behind when the answer is not 200", async () => {
        const dest = path.join(tmp, "gone.bin");
        await expect(downloadFile(`${base}/gone`, dest)).rejects.toBeInstanceOf(HttpError);
        await expect(fs.access(dest)).rejects.toThrow();
    });

    test("fails and removes the partial file when the connection drops mid-transfer", async () => {
        const dest = path.join(tmp, "truncated.bin");
        await expect(downloadFile(`${base}/truncated`, dest)).rejects.toThrow();
        await expect(fs.access(dest)).rejects.toThrow();
    });
});
