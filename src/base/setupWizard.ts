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

export interface SetupWizardConfig {
    title: string;
    providerKey?: string;
    providerType?: "metadata" | "download";
    description: WizardContentBlock[];
    fields: WizardField[];
    /** If set, saved env vars are grouped under a labelled section comment in .env */
    envSection?: { name: string; url?: string };
}
