import { createRequire } from "module";
import { readFileSync } from "fs";
import { join } from "path";
import { DEFAULT_APP_DATA_DIR } from "../constants";

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

export function getInstaller(): Installer {
    try {
        const raw = readFileSync(join(DEFAULT_APP_DATA_DIR, "install.json"), "utf8");
        const installer = (JSON.parse(raw) as { installer: string }).installer;
        if (installer === "yarn" || installer === "pnpm" || installer === "npm") return installer;
        return "unknown";
    } catch {
        return "npm";
    }
}

export function getUpdateCommand(): string {
    switch (getInstaller()) {
        case "yarn":
            return "yarn global add goblin-malin";
        case "pnpm":
            return "pnpm add -g goblin-malin";
        default:
            return "npm install -g goblin-malin";
    }
}
