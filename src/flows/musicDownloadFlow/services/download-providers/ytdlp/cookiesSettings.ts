import { dialogBridge } from "#base/bridges/dialogBridge";
import { type ProviderSettingsRow } from "#base/providerSettings";
import {
    CookiesImportError,
    cookiesFilePath,
    describeCookiesState,
    importCookiesFile,
    readCookiesState,
    removeCookiesFile,
} from "./cookiesFile";

/** The browsers yt-dlp can read cookies from (`--cookies-from-browser`). "off": use the imported cookies.txt, if any. */
export const COOKIE_BROWSERS = ["off", "firefox", "chrome", "edge", "brave", "opera", "vivaldi", "chromium"] as const;

/** Browsers whose cookie store is locked while they run and encrypted on Windows: yt-dlp often cannot read them there. */
const HARD_ON_WINDOWS = new Set(["chrome", "edge", "brave", "opera", "vivaldi", "chromium"]);

/** The browser chosen in the settings, or `undefined` for "off" (and for anything unknown: a hand-edited file). */
export function cookiesBrowserFrom(value: unknown): string | undefined {
    return typeof value === "string" && value !== "off" && (COOKIE_BROWSERS as readonly string[]).includes(value)
        ? value
        : undefined;
}

const IMPORT_STEPS = [
    "YouTube sometimes refuses a download until it sees a signed-in browser. To give yt-dlp your session:",
    "",
    "1. In a private / incognito window, sign in to YouTube, then open youtube.com/robots.txt",
    "2. With the extension “Get cookies.txt LOCALLY” (Chrome, Edge, Brave) or “cookies.txt” (Firefox), export the cookies of that page.",
    "3. Close the private window (YouTube then keeps the session you exported).",
    "4. Drop the exported file on this terminal, or type its path:",
].join("\n");

/** "Import cookies.txt…": asks for the file, checks it, copies it into the app's folder, and says what was found. */
export async function importCookiesInteractively(): Promise<void> {
    const current = await readCookiesState();
    if (current.status === "present") {
        const keep = await dialogBridge.confirm({
            title: "Replace the imported cookies?",
            message: `${describeCookiesState(current)}\n\nImporting another file replaces it.`,
            choices: [
                { label: "Keep it", tone: "primary" },
                { label: "Replace", tone: "danger" },
            ],
        });
        if (keep !== 1) return;
    }

    const answer = await dialogBridge.input({
        title: "Import cookies.txt",
        message: IMPORT_STEPS,
        maxLength: 1000,
    });
    if (answer === null || answer.trim() === "") return;

    try {
        const imported = await importCookiesFile(answer);
        await dialogBridge.confirm({
            title: "Cookies imported",
            message:
                `${imported.cookies} cookies, ${imported.youtube} of them for YouTube, copied to:\n${imported.destination}\n\n` +
                (imported.dropped > 0
                    ? `${imported.dropped} cookie${imported.dropped === 1 ? "" : "s"} of other sites ${imported.dropped === 1 ? "was" : "were"} left out: only YouTube's and Google's are kept.\n\n`
                    : "") +
                "yt-dlp uses them from the next download. You can delete the file you exported: it holds your session.\n" +
                "YouTube signs sessions out after a while: if downloads ask for a sign-in again, import a fresh file.",
            choices: [{ label: "OK", tone: "primary" }],
        });
    } catch (error) {
        if (!(error instanceof CookiesImportError)) throw error;
        await dialogBridge.confirm({
            title: "Cannot use this file",
            message: `${error.message}\n\nNothing was changed.`,
            choices: [{ label: "OK", tone: "primary" }],
            accent: "#d29922",
        });
    }
}

/** "Remove cookies.txt…": asks, then deletes the imported file. */
export async function removeCookiesInteractively(): Promise<void> {
    const current = await readCookiesState();
    if (current.status === "none") {
        await dialogBridge.confirm({
            title: "No cookies.txt",
            message: `There is nothing at ${cookiesFilePath()}.`,
            choices: [{ label: "OK", tone: "primary" }],
        });
        return;
    }
    const answer = await dialogBridge.confirm({
        title: "Remove the imported cookies?",
        message: `${cookiesFilePath()} will be deleted. Downloads then go to YouTube without a session.`,
        choices: [
            { label: "Keep it", tone: "primary" },
            { label: "Remove", tone: "danger" },
        ],
    });
    if (answer === 1) await removeCookiesFile();
}

/** The line under the YtDlp settings: what is imported, how old it is. */
export async function cookiesSettingsStatus(): Promise<string> {
    return describeCookiesState(await readCookiesState());
}

/** The rows YtDlp adds under its settings (see `ProviderConstructorLike.settingsRows`). */
export function cookiesSettingsRows(
    stored: Record<string, boolean | string>,
    status: string | undefined,
    platform: NodeJS.Platform = process.platform
): ProviderSettingsRow[] {
    const browser = cookiesBrowserFrom(stored.cookiesBrowser);
    const rows: ProviderSettingsRow[] = [
        { kind: "action", icon: "⇩", label: "Import cookies.txt…", run: importCookiesInteractively },
        {
            kind: "note",
            text: browser
                ? platform === "win32" && HARD_ON_WINDOWS.has(browser)
                    ? `${browser} often locks its cookies on Windows: close it first, or use Firefox.`
                    : `yt-dlp reads ${browser}'s cookies; the imported file is ignored.`
                : (status ?? "Looking for cookies.txt…"),
        },
        { kind: "action", icon: "✕", label: "Remove the imported cookies.txt…", run: removeCookiesInteractively },
    ];
    return rows;
}
