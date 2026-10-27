import { SetupWizardConfig } from "./setupWizard";

export type ProviderSettingDef =
    | { label: string; defaultValue: boolean; kind: "checkbox" }
    | { label: string; defaultValue: string; kind: "textInput" }
    | { label: string; defaultValue: string; kind: "select"; options: readonly string[] };

export type ProviderSettingsSchema = Record<string, ProviderSettingDef>;

/**
 * Declares that a provider must not run until the user has said yes, once. Used for
 * services that send the user's data to a third party or spend their quota. The copy
 * is shown in a confirm dialog the first time the provider would be used; the answer
 * is stored as `enabled` (+ `consentAsked`) in the provider's settings.
 */
export interface ProviderConsent {
    title: string;
    message: string;
}

/** Minimal interface for a service constructor that may declare settings and display. */
export interface ProviderConstructorLike {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new (...args: any[]): any;
    defaultSettings?: ProviderSettingsSchema;
    setupWizard?: SetupWizardConfig;
    consent?: ProviderConsent;
}
