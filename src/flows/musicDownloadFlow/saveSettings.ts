import fs from 'fs';
import { SettingsStore } from '../../settings/settingsStore';
import {
  MusicDownloadFlowSettings,
  BASE_DEFAULT_MUSIC_DOWNLOAD_FLOW_SETTINGS,
} from './settings';

export interface SaveSettings {
  outputDir: string;
  includeMusicBrainzTags: boolean;
}

function getFlowSettings(): MusicDownloadFlowSettings {
  return SettingsStore.getInstance().getFlowSettings<MusicDownloadFlowSettings>(
    'music-downloader',
    BASE_DEFAULT_MUSIC_DOWNLOAD_FLOW_SETTINGS,
  );
}

export function getDownloadDir(): string {
  return getFlowSettings().download.outputDir;
}

export function getTempDownloadDir(): string {
  return getFlowSettings().download.outputTemporaryDir;
}

export function clearTempDownloads(): void {
  const dir = getTempDownloadDir();
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function getSaveSettings(): SaveSettings {
  const s = getFlowSettings();
  return {
    outputDir: s.download.outputDir,
    includeMusicBrainzTags: false,
  };
}
