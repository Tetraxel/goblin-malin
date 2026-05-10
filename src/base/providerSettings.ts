export type ProviderSettingDef =
  | { label: string; defaultValue: boolean; kind: 'checkbox' }
  | { label: string; defaultValue: string; kind: 'textInput' };

export type ProviderSettingsSchema = Record<string, ProviderSettingDef>;

/** Minimal interface for a service constructor that may declare settings and display. */
export interface ProviderConstructorLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new(...args: any[]): any;
  defaultSettings?: ProviderSettingsSchema;
}
