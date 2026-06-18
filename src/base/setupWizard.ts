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
}
