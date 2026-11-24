import { type StemKind } from "../types";

/** How a stem kind is shown: its name, a short column header and a colour. */
export interface StemKindDisplay {
    label: string;
    acronym: string;
    color: string;
}

/**
 * The stems the models in use make. A model can declare others ("crowd", "reverb", "kick"…): those get a generic
 * display (`fallback`), so a new model never needs a change here to be shown.
 */
const BUILTIN: Record<StemKind, StemKindDisplay> = {
    vocals: { label: "Vocals", acronym: "VOX", color: "#ff79c6" },
    drums: { label: "Drums", acronym: "DRUMS", color: "#ffb86c" },
    bass: { label: "Bass", acronym: "BASS", color: "#8be9fd" },
    other: { label: "Other", acronym: "OTHER", color: "#bd93f9" },
    guitar: { label: "Guitar", acronym: "GTR", color: "#50fa7b" },
    piano: { label: "Piano", acronym: "PIANO", color: "#f1fa8c" },
    instrumental: { label: "Instrumental", acronym: "INST", color: "#6be5c4" },
};

/** "vocals", "no drums", "drum-bass": the stem's name as a model writes it, lower case and trimmed. */
export function normalizeStemKind(name: string): StemKind {
    return name.trim().toLowerCase();
}

function titleCase(kind: string): string {
    return kind.replace(/(^|[\s-])(\p{L})/gu, (_, sep: string, letter: string) => sep + letter.toUpperCase());
}

function fallback(kind: StemKind): StemKindDisplay {
    const label = titleCase(kind);
    return { label, acronym: label.toUpperCase().slice(0, 8), color: "#a0a0a0" };
}

class StemKindRegistry {
    private displays = new Map<StemKind, StemKindDisplay>(Object.entries(BUILTIN));

    get(kind: StemKind): StemKindDisplay {
        const key = normalizeStemKind(kind);
        return this.displays.get(key) ?? fallback(key);
    }

    register(kind: StemKind, display: StemKindDisplay): void {
        this.displays.set(normalizeStemKind(kind), display);
    }
}

export const stemKindRegistry = new StemKindRegistry();

/**
 * The stem sets offered in Settings → Stems: which stems the Stems view shows a column for. A run can make more (a
 * 6-stem model) or other ones: those are listed in the Stems tab all the same.
 */
export const STEM_SETS: Readonly<Record<string, readonly StemKind[]>> = {
    "2 stems": ["vocals", "instrumental"],
    "4 stems": ["vocals", "drums", "bass", "other"],
    "6 stems": ["vocals", "drums", "bass", "guitar", "piano", "other"],
};

export const STEM_SET_KEYS = Object.keys(STEM_SETS);
export const DEFAULT_STEM_SET = "4 stems";

/** The stems of a set; an unknown set counts as the default one. */
export function stemSetKinds(set: string | undefined): readonly StemKind[] {
    return STEM_SETS[set ?? ""] ?? STEM_SETS[DEFAULT_STEM_SET];
}

/** Stems in a stable order: the set's order first, then the others alphabetically. */
export function sortStemKinds(kinds: Iterable<StemKind>, set: readonly StemKind[]): StemKind[] {
    const unique = [...new Set(kinds)];
    const rank = (kind: StemKind) => {
        const i = set.indexOf(kind);
        return i === -1 ? set.length : i;
    };
    return unique.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}
