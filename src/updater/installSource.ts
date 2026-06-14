import { createRequire } from "module";
import { readFileSync } from "fs";
import { join } from "path";
import { DEFAULT_APP_DATA_DIR } from "#constants";

const _require = createRequire(import.meta.url);

export const IS_SEA: boolean = (() => {
    try {
        const sea = _require("node:sea") as { isSea: () => boolean };
        return sea.isSea();
    } catch {
        return false;
    }
})();

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

export function getUpdateCommand(version?: string): string {
    const pkg = version ? `goblin-malin@${version}` : "goblin-malin";
    switch (getInstaller()) {
        case "yarn":
            return `yarn global add ${pkg}`;
        case "pnpm":
            return `pnpm add -g ${pkg}`;
        default:
            return `npm install -g ${pkg}`;
    }
}
