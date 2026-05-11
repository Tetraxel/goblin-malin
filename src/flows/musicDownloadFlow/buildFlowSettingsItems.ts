import { SettingsItem } from '../../settings/buildSettingsItems';
import { MusicDownloadFlowSettings } from './settings';
import { DeepPartial } from '../../utils/types';
import { ProviderConstructorLike, ProviderSettingsSchema } from '../../base/providerSettings';
import { providerDisplayRegistry } from '../../base/providerDisplay';
import { clearTempDownloads } from './saveSettings';

export type ProviderEntry = {
  key: string;
  ctor: ProviderConstructorLike;
};

function schemaOf(ctor: ProviderConstructorLike): ProviderSettingsSchema {
  return (ctor as any).defaultSettings ?? { enabled: { label: 'Enable', defaultValue: true, kind: 'checkbox' } };
}

function providerItems(
  key: string,
  ctor: ProviderConstructorLike,
  stored: Record<string, boolean | string>,
  onChange: (patch: DeepPartial<MusicDownloadFlowSettings>) => void,
  section: 'metadata' | 'download',
): SettingsItem[] {
  const display = providerDisplayRegistry.get(key);
  const schema = schemaOf(ctor);
  const items: SettingsItem[] = [
    { kind: 'providerHeader', label: display.label, color: display.color },
  ];

  for (const [settingKey, def] of Object.entries(schema)) {
    if (def.kind === 'checkbox') {
      const current = (stored[settingKey] as boolean) ?? def.defaultValue;
      items.push({
        kind: 'checkbox', indent: 4,
        label: def.label,
        get: () => current,
        set: (v) => onChange({ [section]: { providers: { [key]: { [settingKey]: v } } } } as DeepPartial<MusicDownloadFlowSettings>),
      });
    } else if (def.kind === 'textInput') {
      const current = (stored[settingKey] as string) ?? def.defaultValue;
      items.push({
        kind: 'textInput', indent: 4,
        label: def.label,
        get: () => current,
        set: (v) => onChange({ [section]: { providers: { [key]: { [settingKey]: v } } } } as DeepPartial<MusicDownloadFlowSettings>),
      });
    }
  }

  return items;
}

export function buildFlowSettingsItems(
  flowSettings: MusicDownloadFlowSettings,
  metadataProviders: ProviderEntry[],
  downloadProviders: ProviderEntry[],
  onChange: (patch: DeepPartial<MusicDownloadFlowSettings>) => void,
): SettingsItem[] {
  const items: SettingsItem[] = [];

  // ── Metadata ──────────────────────────────────────────────────
  items.push({ kind: 'sectionHeader', label: 'Metadata' });
  items.push({
    kind: 'checkbox', indent: 0,
    label: 'Automatically fetch primary metadata on import',
    get: () => flowSettings.metadata.autoFetchOnImport,
    set: (v) => onChange({ metadata: { autoFetchOnImport: v } }),
  });
  items.push({
    kind: 'checkbox', indent: 0,
    label: 'Choose the best metadata automatically',
    get: () => flowSettings.metadata.autoChooseBestSource,
    set: (v) => onChange({ metadata: { autoChooseBestSource: v } }),
  });

  if (metadataProviders.length > 0) {
    items.push({ kind: 'subHeader', label: 'Providers' });
    for (const { key, ctor } of metadataProviders) {
      items.push(...providerItems(
        key, ctor,
        flowSettings.metadata.providers[key] ?? {},
        onChange, 'metadata',
      ));
    }
  }

  // ── Download ──────────────────────────────────────────────────
  items.push({ kind: 'sectionHeader', label: 'Download' });
  items.push({
    kind: 'checkbox',
    indent: 0,
    label: 'Choose the best download source automatically',
    get: () => flowSettings.download.autoChooseBestSource,
    set: (v) => onChange({ download: { autoChooseBestSource: v } }),
  });
  // items.push({
  //   kind: 'checkbox',
  //   indent: 0,
  //   label: 'Auto-save to the specified output directory',
  //   get: () => flowSettings.download.autoSaveToOutputDir,
  //   set: (v) => onChange({ download: { autoSaveToOutputDir: v } }),
  // });
  // items.push({
  //   kind: 'checkbox', 
  //   indent: 0,
  //   label: 'Automatically delete temporary downloads after 24h',
  //   get: () => flowSettings.download.autoDeleteTempAfter24h,
  //   set: (v) => onChange({ download: { autoDeleteTempAfter24h: v } }),
  // });
  // items.push({
  //   kind: 'checkbox',
  //   indent: 0,
  //   label: 'Auto-relocate missing files',
  //   get: () => flowSettings.download.autoRelocateMissingFiles,
  //   set: (v) => onChange({ download: { autoRelocateMissingFiles: v } }),
  // });
  items.push({
    kind: 'textInput',
    indent: 0,
    label: '🗁  Default output directory',
    get: () => flowSettings.download.outputDir,
    set: (v) => onChange({ download: { outputDir: v } }),
  });
  items.push({
    kind: 'textInput',
    indent: 0,
    label: '🗁  Temporary download directory',
    get: () => flowSettings.download.outputTemporaryDir,
    set: (v) => onChange({ download: { outputTemporaryDir: v } }),
  });
  items.push({
    kind: 'action', indent: 0,
    label: '⛒  Clear temporary downloads',
    run: () => clearTempDownloads(),
  });

  if (downloadProviders.length > 0) {
    items.push({ kind: 'subHeader', label: 'Providers' });
    for (const { key, ctor } of downloadProviders) {
      items.push(...providerItems(
        key, ctor,
        flowSettings.download.providers[key] ?? {},
        onChange, 'download',
      ));
    }
  }

  return items;
}
