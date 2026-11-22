import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
    CookiesImportError,
    cleanPastedPath,
    cookiesFilePath,
    describeCookiesState,
    importCookiesFile,
    parseCookiesFile,
    readCookiesState,
    removeCookiesFile,
} from "#flows/musicDownloadFlow/services/download-providers/ytdlp/cookiesFile";
import {
    COOKIE_BROWSERS,
    cookiesBrowserFrom,
    cookiesSettingsRows,
} from "#flows/musicDownloadFlow/services/download-providers/ytdlp/cookiesSettings";
import { explainYtDlpFailure } from "#flows/musicDownloadFlow/services/download-providers/ytdlp/explainError";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-cookies-import-"));
const binDir = path.join(root, "bin");
vi.mock("#utils/appPaths", async (importOriginal) => ({
    ...(await importOriginal<typeof import("#utils/appPaths")>()),
    getBinDir: () => binDir,
}));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const NOW = Date.UTC(2026, 10, 17);
const FUTURE = Math.floor(NOW / 1000) + 86_400 * 200;
const PAST = Math.floor(NOW / 1000) - 86_400;
const HEADER = "# Netscape HTTP Cookie File";
/** One line of a cookies.txt: domain, include-subdomains, path, secure, expiry, name, value. */
const line = (domain: string, expiry: number, name = "SID") =>
    [domain, "TRUE", "/", "TRUE", String(expiry), name, "secret-value"].join("\t");
const file = (...lines: string[]) => [HEADER, "", ...lines, ""].join("\n");

let counter = 0;
const write = (text: string, name = `export-${++counter}.txt`): string => {
    const p = path.join(root, name);
    fs.writeFileSync(p, text);
    return p;
};

beforeEach(() => fs.rmSync(binDir, { recursive: true, force: true }));

describe("parseCookiesFile", () => {
    test("counts the cookies, the YouTube ones, and the YouTube ones that expired", () => {
        const summary = parseCookiesFile(
            file(
                line(".youtube.com", FUTURE),
                line(".youtube.com", PAST, "OLD"),
                line("www.youtube.com", 0, "SESSION"),
                line(".google.com", FUTURE),
                line(".notyoutube.com", FUTURE)
            ),
            NOW
        );
        expect(summary).toEqual({ cookies: 5, youtube: 3, youtubeExpired: 1, hasHeader: true });
    });

    test("a cookie the browser hides from scripts (#HttpOnly_) is still a cookie, not a comment", () => {
        const summary = parseCookiesFile(file(`#HttpOnly_${line(".youtube.com", FUTURE)}`), NOW);
        expect(summary).toMatchObject({ cookies: 1, youtube: 1 });
    });

    test("knows a file without the first line yt-dlp insists on", () => {
        expect(parseCookiesFile(line(".youtube.com", FUTURE), NOW).hasHeader).toBe(false);
        expect(parseCookiesFile(`# HTTP Cookie File\n${line(".youtube.com", FUTURE)}`, NOW).hasHeader).toBe(true);
    });

    test("tells a JSON export, spaces instead of tabs, and an empty file apart", () => {
        expect(() => parseCookiesFile('[{"domain": ".youtube.com"}]')).toThrow(/JSON/);
        expect(() => parseCookiesFile(`${HEADER}\n.youtube.com TRUE / TRUE 0 SID abc`)).toThrow(/TAB-separated/);
        expect(() => parseCookiesFile(`${HEADER}\n# nothing else\n`)).toThrow(/no cookies/);
        expect(() => parseCookiesFile("")).toThrow(CookiesImportError);
    });

    test("a byte-order mark is not part of the first line", () => {
        expect(parseCookiesFile(`\uFEFF${file(line(".youtube.com", FUTURE))}`, NOW).cookies).toBe(1);
    });
});

describe("cleanPastedPath", () => {
    test("takes what a Windows terminal pastes when a file is dropped on it", () => {
        const clean = (text: string) => cleanPastedPath(text, "win32");
        expect(clean('  "C:\\Users\\me\\My Files\\cookies.txt"  ')).toBe("C:\\Users\\me\\My Files\\cookies.txt");
        expect(clean("& 'C:\\Users\\me\\cookies.txt'")).toBe("C:\\Users\\me\\cookies.txt");
        expect(clean("file:///C:/Users/me/My%20Files/cookies.txt")).toBe("C:/Users/me/My Files/cookies.txt");
        // A plain path, backslashes and all, is left alone.
        expect(clean("D:\\export\\cookies.txt")).toBe("D:\\export\\cookies.txt");
    });

    test("takes what a macOS / Linux terminal pastes: escaped spaces, quotes, ~", () => {
        const clean = (text: string) => cleanPastedPath(text, "linux");
        expect(clean("/home/me/My\\ Files/cookies.txt")).toBe("/home/me/My Files/cookies.txt");
        expect(clean("'/home/me/My Files/cookies.txt'")).toBe("/home/me/My Files/cookies.txt");
        expect(clean("file:///home/me/My%20Files/cookies.txt")).toBe("/home/me/My Files/cookies.txt");
        expect(clean("~/Downloads/cookies.txt")).toBe(path.join(os.homedir(), "Downloads", "cookies.txt"));
    });
});

describe("importCookiesFile", () => {
    test("copies a good file into the app's folder and leaves the original where it is", async () => {
        const source = write(file(line(".youtube.com", FUTURE), line(".google.com", FUTURE)));

        const result = await importCookiesFile(`"${source}"`, NOW);

        expect(result).toMatchObject({ cookies: 2, youtube: 1, dropped: 0, destination: cookiesFilePath() });
        expect(parseCookiesFile(fs.readFileSync(cookiesFilePath(), "utf8"), NOW)).toMatchObject({
            cookies: 2,
            youtube: 1,
        });
        expect(fs.existsSync(source)).toBe(true);
        // No staging file is left beside it.
        expect(fs.readdirSync(binDir)).toEqual(["cookies.txt"]);
    });

    test("keeps only YouTube's and Google's cookies, and says how many others it left out (COOKIE-02)", async () => {
        const source = write(
            file(
                line(".youtube.com", FUTURE),
                line("accounts.google.com", FUTURE),
                line(".mybank.example", FUTURE),
                `#HttpOnly_${line(".mail.example", FUTURE)}`
            )
        );

        const result = await importCookiesFile(source, NOW);

        expect(result).toMatchObject({ cookies: 2, youtube: 1, dropped: 2 });
        const copy = fs.readFileSync(cookiesFilePath(), "utf8");
        expect(copy).not.toContain("mybank");
        expect(copy).not.toContain("mail.example");
        expect(copy.split("\n")[0]).toBe(HEADER);
    });

    test("adds the first line yt-dlp insists on when the export left it out", async () => {
        const source = write(line(".youtube.com", FUTURE));

        await importCookiesFile(source, NOW);

        expect(fs.readFileSync(cookiesFilePath(), "utf8").split("\n")[0]).toBe(HEADER);
        expect(parseCookiesFile(fs.readFileSync(cookiesFilePath(), "utf8"), NOW).hasHeader).toBe(true);
    });

    test("refuses a file that cannot work, and changes nothing", async () => {
        fs.mkdirSync(binDir, { recursive: true });
        fs.writeFileSync(cookiesFilePath(), "THE CURRENT FILE");
        const cases: [string, RegExp][] = [
            [write(file(line(".example.com", FUTURE))), /no youtube\.com cookies/],
            [write(file(line(".youtube.com", PAST))), /expired/],
            [write("not a cookies file"), /no cookies|TAB/],
            [path.join(root, "missing.txt"), /No file at/],
            [root, /not a file/],
            ["   ", /No file given/],
        ];
        for (const [input, message] of cases) {
            await expect(importCookiesFile(input, NOW), input).rejects.toThrow(message);
        }
        expect(fs.readFileSync(cookiesFilePath(), "utf8")).toBe("THE CURRENT FILE");
        expect(fs.readdirSync(binDir)).toEqual(["cookies.txt"]);
    });

    test("replaces the file that was imported before", async () => {
        await importCookiesFile(write(file(line(".youtube.com", FUTURE, "FIRST"))), NOW);
        await importCookiesFile(write(file(line(".youtube.com", FUTURE, "SECOND"))), NOW);

        expect(fs.readFileSync(cookiesFilePath(), "utf8")).toContain("SECOND");
        expect(fs.readFileSync(cookiesFilePath(), "utf8")).not.toContain("FIRST");
    });
});

describe("what the settings say about the imported file", () => {
    test("nothing imported, then imported, then removed", async () => {
        expect(await readCookiesState(NOW)).toEqual({ status: "none" });
        expect(describeCookiesState({ status: "none" })).toMatch(/No cookies\.txt imported/);

        await importCookiesFile(write(file(line(".youtube.com", FUTURE), line(".youtube.com", FUTURE, "B"))), NOW);
        const state = await readCookiesState(Date.now());
        expect(state).toMatchObject({ status: "present", ageDays: 0, summary: { youtube: 2 } });
        expect(describeCookiesState(state)).toBe("cookies.txt imported today: 2 YouTube cookies");

        expect(await removeCookiesFile()).toBe(true);
        expect(await removeCookiesFile()).toBe(false);
        expect(await readCookiesState(NOW)).toEqual({ status: "none" });
    });

    test("an old file is flagged as probably signed out; one that expired says so", () => {
        const summary = { cookies: 9, youtube: 3, youtubeExpired: 0, hasHeader: true };
        const present = (ageDays: number, youtubeExpired = 0) => ({
            status: "present" as const,
            summary: { ...summary, youtubeExpired },
            ageDays,
            modifiedAt: new Date(NOW),
        });
        expect(describeCookiesState(present(3))).toBe("cookies.txt imported 3 days ago: 3 YouTube cookies");
        expect(describeCookiesState(present(1))).toContain("1 day ago");
        expect(describeCookiesState(present(45))).toMatch(/imported 45 days ago.*Old: YouTube may have signed it out/);
        expect(describeCookiesState(present(2, 3))).toMatch(/all expired/);
    });

    test("an imported file that is damaged is reported, not trusted", async () => {
        fs.mkdirSync(binDir, { recursive: true });
        fs.writeFileSync(cookiesFilePath(), "garbage");
        const state = await readCookiesState(NOW);
        expect(state.status).toBe("unreadable");
        expect(describeCookiesState(state)).toMatch(/unusable/);
    });
});

describe("the cookies rows of the YtDlp settings", () => {
    test("offer import and remove, with the status between them", () => {
        const rows = cookiesSettingsRows({}, "cookies.txt imported today: 2 YouTube cookies");
        expect(rows.map((row) => (row.kind === "action" ? `${row.icon} ${row.label}` : row.text))).toEqual([
            "⇩ Import cookies.txt…",
            "cookies.txt imported today: 2 YouTube cookies",
            "✕ Remove the imported cookies.txt…",
        ]);
        expect(cookiesSettingsRows({}, undefined)[1]).toMatchObject({ kind: "note", text: "Looking for cookies.txt…" });
    });

    test("with a browser chosen, say that the file is ignored, and warn about the hard ones on Windows", () => {
        const noteOf = (browser: string, platform: NodeJS.Platform) => {
            const note = cookiesSettingsRows({ cookiesBrowser: browser }, "status", platform)[1];
            return note.kind === "note" ? note.text : "";
        };
        expect(noteOf("firefox", "win32")).toMatch(/imported file is ignored/);
        expect(noteOf("firefox", "win32")).not.toMatch(/locks/);
        expect(noteOf("chrome", "win32")).toMatch(/chrome often locks its cookies on Windows/);
        expect(noteOf("chrome", "linux")).toMatch(/imported file is ignored/);
    });

    test("only a known browser counts; 'off' and anything else mean the imported file", () => {
        for (const browser of COOKIE_BROWSERS.filter((b) => b !== "off"))
            expect(cookiesBrowserFrom(browser)).toBe(browser);
        for (const other of ["off", "", "netscape", "Chrome; rm -rf /", undefined, 3, null]) {
            expect(cookiesBrowserFrom(other)).toBeUndefined();
        }
    });
});

describe("explainYtDlpFailure", () => {
    test("turns yt-dlp's bot check into the fix the app has", () => {
        const help = explainYtDlpFailure(
            "ERROR: [youtube] abc: Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies for the authentication."
        );
        expect(help).toMatchObject({ short: "YouTube wants a sign-in", needsCookies: true });
        expect(help?.advice).toContain("Import cookies.txt");
        // The straight apostrophe too.
        expect(explainYtDlpFailure("Sign in to confirm you're not a bot")?.needsCookies).toBe(true);
    });

    test("knows an age gate, a browser whose cookies could not be read, and a 403", () => {
        expect(
            explainYtDlpFailure("Sign in to confirm your age. This video may be inappropriate for some users.")
        ).toMatchObject({
            short: "Age-restricted video",
        });
        expect(
            explainYtDlpFailure(
                "ERROR: Could not copy Chrome cookie database. See https://github.com/yt-dlp/yt-dlp/issues/7271"
            )
        ).toMatchObject({
            short: "Cannot read the browser's cookies",
        });
        expect(explainYtDlpFailure("ERROR: unable to download video data: HTTP Error 403: Forbidden")).toMatchObject({
            short: "Blocked (403)",
            needsCookies: false,
        });
    });

    test("says nothing about a failure it does not know", () => {
        expect(explainYtDlpFailure("ffmpeg exited with code 1")).toBeUndefined();
        expect(explainYtDlpFailure("")).toBeUndefined();
    });
});
