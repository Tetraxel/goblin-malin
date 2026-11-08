import { spawn } from "child_process";

/**
 * Opens `url` in the default browser using the platform's native opener.
 *
 * The URL is passed as a single argv entry to `spawn` — never through a shell — so characters like `"`, `&`
 * or `%VAR%` in it are plain data and cannot break out into command execution. Only http(s) URLs are
 * accepted, and the value handed to the opener is the parsed `href` (which percent-encodes quotes/spaces).
 *
 * Why not the `open` package: in SEA builds it is pre-bundled with a placeholder `import.meta.url` and can
 * fail silently, so SEA-reachable call sites need this native path.
 *
 * Failures are swallowed: there is nothing useful to tell the user about a browser that didn't open.
 * Returns whether an opener was launched.
 */
export function openUrl(url: string): boolean {
    let href: string;
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
        href = parsed.href;
    } catch {
        return false;
    }

    const [bin, args]: [string, string[]] =
        process.platform === "win32"
            ? ["rundll32.exe", ["url.dll,FileProtocolHandler", href]]
            : process.platform === "darwin"
              ? ["open", [href]]
              : ["xdg-open", [href]];

    spawn(bin, args, { detached: true, stdio: "ignore" })
        .on("error", () => {})
        .unref();
    return true;
}
