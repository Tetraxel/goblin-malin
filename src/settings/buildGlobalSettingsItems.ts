import { AppSettings } from './appSettings';
import { DeepPartial } from '../utils/types';
import { SettingsItem } from './buildSettingsItems';
import { clearCache } from '../utils/cache';
import { THEME_KEYS } from '../base/theme';

export function buildGlobalSettingsItems(
  settings: AppSettings,
  onChange: (patch: DeepPartial<AppSettings>) => void,
): SettingsItem[] {
  return [
    {
      kind: 'sectionHeader',
      label: 'General'
    },
    {
      kind: 'select',
      indent: 0,
      label: 'Theme',
      options: THEME_KEYS,
      get: () => settings.general.theme,
      set: (v) => onChange({ general: { theme: v } }),
    },
    {
      kind: 'checkbox',
      indent: 0,
      label: 'Re-open last session on start-up',
      get: () => settings.general.reopenLastSession,
      set: (v) => onChange({ general: { reopenLastSession: v } }),
    },
    {
      kind: 'checkbox',
      indent: 0,
      label: 'Enable animations',
      get: () => settings.general.animationsEnabled,
      set: (v) => onChange({ general: { animationsEnabled: v } }),
    },
    {
      kind: 'textInput',
      indent: 0,
      label: '🗁  App data directory',
      get: () => settings.general.appDataDir,
      set: (v) => onChange({ general: { appDataDir: v } }),
    },
    {
      kind: 'action',
      indent: 0,
      label: '⛒  Clear cache',
      run: () => clearCache(),
    },
  ];
}
