export type WizardContentBlock =
    | { type: "paragraph"; text: string }
    | { type: "note"; text: string }
    | { type: "orderedList"; items: WizardListItem[] };

export type WizardListItem = { type: "text"; text: string } | { type: "link"; text: string; url: string };

export interface WizardField {
    envVar: string;
    label: string;
    hint?: string;
    required?: boolean;
    /** Mask the value with asterisks while editing and displaying (e.g. passwords). */
    secret?: boolean;
}

export interface WizardMode {
    id: string;
    label: string;
    description?: string; // one-line helper shown under the chooser
    details?: WizardContentBlock[]; // richer content (notes, steps, links) shown above the fields
    fields: WizardField[];
}

export interface SetupWizardConfig {
    title: string;
    providerKey?: string;
    providerType?: "metadata" | "download";
    description: WizardContentBlock[];
    fields: WizardField[]; // used only when modes is absent (back-compat)
    modeEnvVar?: string; // e.g. "SPOTIFY_AUTH_MODE"
    modes?: WizardMode[]; // if present → wizard shows a mode chooser
    /** If set, saved env vars are grouped under a labelled section comment in .env */
    envSection?: { name: string; url?: string };
    /**
     * One line telling the user what completing this setup unlocks. Settings shows it under the
     * provider's "Setup Wizard" row for as long as the setup is not complete (see `isSetupComplete`).
     */
    benefits?: string;
}

/**
 * Whether the wizard has been filled in: every required field of the active mode has a value.
 * By convention a mode without fields is the credential-less, limited option (e.g. a scraped page),
 * so choosing it does not count as complete.
 */
export function isSetupComplete(config: SetupWizardConfig, env: NodeJS.ProcessEnv = process.env): boolean {
    let fields = config.fields;
    if (config.modes && config.modes.length > 0) {
        const selected = config.modeEnvVar ? env[config.modeEnvVar] : undefined;
        const mode = config.modes.find((m) => m.id === selected) ?? config.modes[0];
        if (mode.fields.length === 0) return false;
        fields = mode.fields;
    }
    return fields.every((f) => f.required === false || !!env[f.envVar]?.trim());
}
