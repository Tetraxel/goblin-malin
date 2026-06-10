import dotenv from "dotenv";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const PROJECT_ROOT = path.join(__dirname, "..");

/** True when running via `tsx` in dev (source file is `.ts`). False for compiled production builds. */
export const IS_DEV = __filename.endsWith(".ts");

function getPlatformDefaultDataDir(): string {
    switch (process.platform) {
        case "win32":
            return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "goblin-malin");
        case "darwin":
            return path.join(os.homedir(), "Library", "Application Support", "goblin-malin");
        default:
            return path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"), "goblin-malin");
    }
}

export const DEFAULT_APP_DATA_DIR = IS_DEV ? path.join(PROJECT_ROOT, "data") : getPlatformDefaultDataDir();

dotenv.config({ path: path.join(DEFAULT_APP_DATA_DIR, ".env") });

function resolveAppVersion(): string {
    try {
        return __APP_VERSION__;
    } catch {
        const _req = createRequire(import.meta.url);
        return (_req("../package.json") as { version: string }).version;
    }
}

export const APP_VERSION = resolveAppVersion();
