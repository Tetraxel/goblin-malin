import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createRequire } from "node:module";

const _require = createRequire(import.meta.url);

export async function renderToImageBrowser(
    cols: number,
    rows: number,
    rawData: string,
    outputPath: string,
): Promise<void> {
    const { chromium } = await import("playwright");

    // Inline xterm assets so the page is fully self-contained (no network requests)
    const xtermJsPath: string = _require.resolve("xterm/lib/xterm.js");
    const xtermCssPath: string = _require.resolve("xterm/css/xterm.css");
    const xtermJs = readFileSync(xtermJsPath, "utf-8");
    const xtermCss = readFileSync(xtermCssPath, "utf-8");

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
${xtermCss}
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { background: #1e1e1e; display: inline-block; }
#t { display: inline-block; }
</style>
</head>
<body>
<div id="t"></div>
<script>${xtermJs}</script>
<script>
const term = new Terminal({
  cols: ${cols},
  rows: ${rows},
  allowProposedApi: true,
  fontFamily: "'Cascadia Mono', 'Cascadia Code', Consolas, monospace",
  fontSize: 14,
  lineHeight: 1.2,
  cursorStyle: "block",
  cursorBlink: false,
  theme: { background: "#1e1e1e", foreground: "#c0c0c0" }
});
term.open(document.getElementById("t"));
window.__termReady = false;
term.write(${JSON.stringify(rawData)}, () => { window.__termReady = true; });
</script>
</body>
</html>`;

    // Prefer the already-installed system Edge (no browser download needed).
    // Fall back to downloading a Chromium build if Edge is not found.
    let browser;
    try {
        browser = await chromium.launch({ channel: "msedge", headless: true });
    } catch {
        browser = await chromium.launch({ headless: true });
    }

    try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: "domcontentloaded" });
        await page.waitForFunction("() => window.__termReady", { timeout: 10_000 });
        // Allow one animation frame for xterm to finish painting
        await page.evaluate("() => new Promise(r => requestAnimationFrame(r))");

        const el = await page.$(".xterm-screen");
        if (!el) throw new Error("xterm-screen element not found in rendered page");

        await mkdir(dirname(outputPath), { recursive: true });
        await el.screenshot({ path: outputPath as `${string}.png` });
    } finally {
        await browser.close();
    }
}
