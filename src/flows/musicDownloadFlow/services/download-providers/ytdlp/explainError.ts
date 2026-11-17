/**
 * What a yt-dlp failure means to the user, and what to do about it. yt-dlp's own messages ("Sign in to confirm you’re
 * not a bot. Use --cookies-from-browser or --cookies for the authentication.") name command-line switches the app does
 * not expose; the same fix is in the app's Settings. The raw message always stays in the log.
 */
export type YtDlpFailureHelp = {
    /** Short enough for a status cell. */
    short: string;
    /** One or two sentences: what happened and the way out. */
    advice: string;
    /** Whether the way out is cookies (the settings row is under Settings → Download → YtDlp). */
    needsCookies: boolean;
};

const COOKIES_WHERE = "Settings → Download → YtDlp → “Import cookies.txt…”, or “Cookies from browser”";

const RULES: { test: RegExp; help: YtDlpFailureHelp }[] = [
    {
        // The browser's cookie store could not be read: not a YouTube problem, so before the sign-in rules.
        test: /could not copy .* cookie database|failed to decrypt|could not find .* cookies database|unable to .* cookies? database/i,
        help: {
            short: "Cannot read the browser's cookies",
            advice:
                "yt-dlp could not read the cookies of the browser chosen in Settings. Close that browser and try again " +
                "(Chrome, Edge and Brave lock them while open and encrypt them on Windows), pick Firefox, or import a cookies.txt " +
                `instead (${COOKIES_WHERE}).`,
            needsCookies: true,
        },
    },
    {
        test: /sign in to confirm you.?re not a bot/i,
        help: {
            short: "YouTube wants a sign-in",
            advice: `YouTube asked for a sign-in to prove this is not a bot. Give yt-dlp your YouTube cookies (${COOKIES_WHERE}).`,
            needsCookies: true,
        },
    },
    {
        test: /sign in to confirm your age|age[- ]restricted|inappropriate for some users/i,
        help: {
            short: "Age-restricted video",
            advice: `This video is age-restricted: only a signed-in account can play it. Give yt-dlp your YouTube cookies (${COOKIES_WHERE}).`,
            needsCookies: true,
        },
    },
    {
        test: /http error 403|403: forbidden/i,
        help: {
            short: "Blocked (403)",
            advice: "The site refused the download (403). Try again later; if it keeps happening, update yt-dlp (Settings → Download → YtDlp → “Auto-download latest binaries”).",
            needsCookies: false,
        },
    },
];

/** The help for a yt-dlp failure message, or `undefined` when it is nothing the app knows how to explain. */
export function explainYtDlpFailure(message: string): YtDlpFailureHelp | undefined {
    return RULES.find((rule) => rule.test.test(message))?.help;
}
