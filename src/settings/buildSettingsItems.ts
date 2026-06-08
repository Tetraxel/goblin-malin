export type SettingsItem =
    | { kind: "sectionHeader"; label: string }
    | { kind: "subHeader"; label: string }
    | { kind: "providerHeader"; label: string; color: string; missingCredentials?: boolean }
    | { kind: "checkbox"; label: string; indent: number; get: () => boolean; set: (v: boolean) => void }
    | { kind: "textInput"; label: string; indent: number; get: () => string; set: (v: string) => void }
    | {
          kind: "select";
          label: string;
          indent: number;
          options: readonly string[];
          get: () => string;
          set: (v: string) => void;
      }
    | { kind: "action"; label: string; indent: number; run: () => void }
    | { kind: "readonlyText"; label: string; indent: number; value: string };

export function isInteractive(item: SettingsItem): boolean {
    return item.kind === "checkbox" || item.kind === "textInput" || item.kind === "select" || item.kind === "action";
}

// sectionHeader uses marginTop={1} and subHeader uses paddingTop={1}, both adding 1 extra visual row
export function itemRowHeight(item: SettingsItem): number {
    if (item.kind === "sectionHeader" || item.kind === "subHeader") return 2;
    return 1;
}

/**
 * Filter a flat settings item list while preserving ancestor headers for each
 * matching interactive item. Also expands all items under a header whose label
 * matches the query.
 */
export function filterSettingsItems(items: SettingsItem[], query: string): SettingsItem[] {
    if (!query.trim()) return items;
    const q = query.toLowerCase();

    const result: SettingsItem[] = [];
    let pendingSection: SettingsItem | null = null;
    let pendingSubHeader: SettingsItem | null = null;
    let pendingProvider: SettingsItem | null = null;

    for (const item of items) {
        if (item.kind === "sectionHeader") {
            pendingSection = item;
            pendingSubHeader = null;
            pendingProvider = null;
            continue;
        }
        if (item.kind === "subHeader") {
            pendingSubHeader = item;
            pendingProvider = null;
            continue;
        }
        if (item.kind === "providerHeader") {
            pendingProvider = item;
            continue;
        }

        const selfLabel = "label" in item ? item.label.toLowerCase() : "";
        const sectionLbl = pendingSection && "label" in pendingSection ? pendingSection.label.toLowerCase() : "";
        const subLbl = pendingSubHeader && "label" in pendingSubHeader ? pendingSubHeader.label.toLowerCase() : "";
        const providerLbl = pendingProvider && "label" in pendingProvider ? pendingProvider.label.toLowerCase() : "";

        const matches =
            selfLabel.includes(q) || sectionLbl.includes(q) || subLbl.includes(q) || providerLbl.includes(q);

        if (matches) {
            if (pendingSection && !result.includes(pendingSection)) result.push(pendingSection);
            if (pendingSubHeader && !result.includes(pendingSubHeader)) result.push(pendingSubHeader);
            if (pendingProvider && !result.includes(pendingProvider)) result.push(pendingProvider);
            result.push(item);
        }
    }

    return result;
}
