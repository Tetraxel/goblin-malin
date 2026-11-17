import { readFileSync } from "fs";
import { join } from "path";
import { DEFAULT_APP_DATA_DIR } from "#constants";

type Installer = "npm" | "yarn" | "pnpm" | "unknown";

/**
 * Which package manager owns a script path, from where each one keeps its global packages. Only those folders count:
 * a user, a project or a folder that happens to be called "yarn" or "npm" must not pick the installer.
 */
export function detectInstallerFromPath(scriptPath: string): Installer | null {
    const p = scriptPath.replace(/\\/g, "/");
    // Yarn classic: ~/.config/yarn/global/node_modules, %LOCALAPPDATA%/Yarn/Data/global/node_modules
    if (/\/yarn\/(?:data\/)?global\/node_modules\//i.test(p)) return "yarn";
    // pnpm: .../pnpm/global/<n>/node_modules (its packages sit in a ".pnpm" store folder)
    if (/\/pnpm\/global\//i.test(p) || p.includes("/.pnpm/")) return "pnpm";
    // npm: %APPDATA%/npm/node_modules, <prefix>/lib/node_modules
    if (/\/npm\/node_modules\//i.test(p) || p.includes("/lib/node_modules/")) return "npm";
    return null;
}

// Detect from the running script path — more reliable than install.json when
// both npm and yarn have the package installed (different global locations).
function detectInstallerFromArgv(): Installer | null {
    return detectInstallerFromPath(process.argv[1] ?? "");
}

export function getInstaller(): Installer {
    const fromArgv = detectInstallerFromArgv();
    if (fromArgv) return fromArgv;
    try {
        const raw = readFileSync(join(DEFAULT_APP_DATA_DIR, "install.json"), "utf8");
        const installer = (JSON.parse(raw) as { installer: string }).installer;
        if (installer === "yarn" || installer === "pnpm" || installer === "npm") return installer;
        return "unknown";
    } catch {
        return "npm";
    }
}

// The version comes from a GitHub release tag (network data) and ends up in a command line, so only plain
// semver is accepted; anything else falls back to the unversioned package (= latest).
const SAFE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** The package-manager command as program + argument list (no shell parsing involved). */
export function getUpdateArgv(version?: string): { bin: string; args: string[] } {
    const pkg = version && SAFE_VERSION.test(version) ? `goblin-malin@${version}` : "goblin-malin";
    switch (getInstaller()) {
        case "yarn":
            return { bin: "yarn", args: ["global", "add", pkg] };
        case "pnpm":
            return { bin: "pnpm", args: ["add", "-g", pkg] };
        default:
            return { bin: "npm", args: ["install", "-g", pkg] };
    }
}

/** Display form of {@link getUpdateArgv}. */
export function getUpdateCommand(version?: string): string {
    const { bin, args } = getUpdateArgv(version);
    return [bin, ...args].join(" ");
}
