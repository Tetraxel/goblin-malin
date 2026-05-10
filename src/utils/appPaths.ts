import path from 'path';
import { SettingsStore } from '../settings/settingsStore';

function dataDir(): string {
  return SettingsStore.getInstance().getAppSettings().general.appDataDir;
}

export function getCacheDir(): string { return path.join(dataDir(), 'cache'); }
export function getBinDir(): string { return path.join(dataDir(), 'bin'); }
export function getLogsPath(): string { return path.join(dataDir(), 'app.log'); }
