import path from "path";
import { fileURLToPath } from "url";
import { DEFAULT_APP_DATA_DIR } from "#constants";

// In dev (tsx), import.meta.url ends in .ts → this file is src/utils/, so ../assets = src/assets/.
// In prod (tsup bundle), import.meta.url = dist/index.js → dist/ + assets = dist/assets/.
const _assetsDir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    import.meta.url.endsWith(".ts") ? "../assets" : "assets"
);

export function getAssetPath(...segments: string[]): string {
    return path.join(_assetsDir, ...segments);
}

/**
 * The folder everything lives in. Always the live value of `DEFAULT_APP_DATA_DIR` (`GOBLIN_DATA_DIR`, else
 * the dev/OS default): it is never read back from `settings.json`, so `sessions.json`, `settings.json`,
 * `cache/`, `bin/` and `app.log` can't end up in different places.
 */
export function getAppDataDir(): string {
    return DEFAULT_APP_DATA_DIR;
}

export function getCacheDir(): string {
    return path.join(getAppDataDir(), "cache");
}
export function getBinDir(): string {
    return path.join(getAppDataDir(), "bin");
}
export function getLogsPath(): string {
    return path.join(getAppDataDir(), "app.log");
}
