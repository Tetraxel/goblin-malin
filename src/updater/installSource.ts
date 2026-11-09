import { readFileSync } from "fs";
import { join } from "path";
import { DEFAULT_APP_DATA_DIR } from "#constants";

type Installer = "npm" | "yarn" | "pnpm" | "unknown";

// Detect from the running script path — more reliable than install.json when
// both npm and yarn have the package installed (different global locations).
function detectInstallerFromArgv(): Installer | null {
    const scriptPath = (process.argv[1] ?? "").replace(/\\/g, "/");
    if (scriptPath.includes("/Yarn/") || scriptPath.includes("/yarn/")) return "yarn";
    if (scriptPath.includes("/.pnpm/") || scriptPath.includes("/pnpm/")) return "pnpm";
    if (scriptPath.includes("/npm/")) return "npm";
    return null;
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
