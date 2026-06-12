import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import os from "os";
import { execFileSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

function detectInstaller() {
    const ua = process.env.npm_config_user_agent ?? "";
    if (ua.startsWith("yarn")) return "yarn";
    if (ua.startsWith("pnpm")) return "pnpm";
    if (ua.startsWith("npm")) return "npm";
    return undefined;
}

// MUST reflects the paths in src\constants.ts
function getAppDataDir() {
    switch (process.platform) {
        case "win32":
            return join(process.env.APPDATA ?? join(os.homedir(), "AppData", "Roaming"), "goblin-malin");
        case "darwin":
            return join(os.homedir(), "Library", "Application Support", "goblin-malin");
        default:
            return join(process.env.XDG_DATA_HOME ?? join(os.homedir(), ".local", "share"), "goblin-malin");
    }
}

const configDir = getAppDataDir();
mkdirSync(configDir, { recursive: true });
writeFileSync(
    join(configDir, "install.json"),
    JSON.stringify({ installer: detectInstaller(), installedAt: new Date().toISOString() })
);

// Run compat patch only in dev (script won't exist in published package)
const patchScript = join(__dirname, "patch-pkg-compat.mjs");
if (existsSync(patchScript)) {
    execFileSync(process.execPath, [patchScript], { stdio: "inherit" });
}
