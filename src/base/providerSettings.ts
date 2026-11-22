import { type SetupWizardConfig } from "./setupWizard";

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

/**
 * An extra row a provider adds under its own settings, for what a plain checkbox / text / select cannot do (import a
 * file, show what is on disk). Rows are built each time the settings are drawn, so they must be cheap and never
 * touch the disk: what needs reading goes into `settingsStatus`, which the settings modal awaits in the background.
 */
export type ProviderSettingsRow =
    /** Runs at once when chosen (not part of the Save / Cancel draft); a failure is logged by the settings. */
    | {
          kind: "action";
          label: string;
          /** One glyph shown before the label (default `›`). */
          icon?: string;
          run: () => void | Promise<void>;
      }
    /** A dim line under the row above it. */
    | { kind: "note"; text: string };

/** Minimal interface for a service constructor that may declare settings and display. */
export interface ProviderConstructorLike {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new (...args: any[]): any;
    defaultSettings?: ProviderSettingsSchema;
    /** One sentence saying what the provider does for the user (shown in the first-run provider picker). */
    summary?: string;
    /**
     * Extra rows under the provider's settings. `stored` is the provider's settings as being edited; `status` is what
     * `settingsStatus` last answered (undefined until it has).
     */
    settingsRows?: (stored: Record<string, boolean | string>, status: string | undefined) => ProviderSettingsRow[];
    /**
     * A line about the provider's state on disk or elsewhere (e.g. "cookies.txt imported 3 days ago"), read in the
     * background each time the settings open and after every dialog closes. Undefined: nothing to say.
     */
    settingsStatus?: () => Promise<string | undefined>;
    setupWizard?: SetupWizardConfig;
    consent?: ProviderConsent;
    /** Download providers: the platforms whose links they can download, or "any" (see `DownloadService.linkPlatforms`). */
    linkPlatforms?: readonly string[] | "any";
}
