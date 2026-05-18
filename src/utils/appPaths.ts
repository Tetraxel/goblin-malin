import path from 'path';
import { fileURLToPath } from 'url';
import { SettingsStore } from '../settings/settingsStore';

// In dev (tsx), import.meta.url ends in .ts → this file is src/utils/, so ../assets = src/assets/.
// In prod (tsup bundle), import.meta.url = dist/index.js → dist/ + assets = dist/assets/.
const _assetsDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  import.meta.url.endsWith('.ts') ? '../assets' : 'assets',
);

export function getAssetPath(...segments: string[]): string {
  return path.join(_assetsDir, ...segments);
}

function getAppDataDir(): string {
  return SettingsStore.getInstance().getAppSettings().general.appDataDir;
}

export function getCacheDir(): string { return path.join(getAppDataDir(), 'cache'); }
export function getBinDir(): string { return path.join(getAppDataDir(), 'bin'); }
export function getLogsPath(): string { return path.join(getAppDataDir(), 'app.log'); }
