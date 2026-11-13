import stringWidth from "string-width";
import wrapAnsi from "wrap-ansi";

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
    | { kind: "readonlyText"; label: string; indent: number; value: string }
    /** A dim line of information under the row above it (never selectable). It stays with that row when searching. */
    | { kind: "note"; indent: number; text: string };

export function isInteractive(item: SettingsItem): boolean {
    return item.kind === "checkbox" || item.kind === "textInput" || item.kind === "select" || item.kind === "action";
}

/** Number of terminal lines `text` takes in `width` columns, wrapped the way Ink wraps a `<Text>`. */
function wrappedLines(text: string, width: number): number {
    if (width <= 0) return 1;
    return Math.max(1, wrapAnsi(text, width, { trim: false, hard: true }).split("\n").length);
}

/**
 * How many terminal lines a row takes. A section header and a sub-header add one blank line above their text
 * (`marginTop` / `paddingTop`). A row whose label is longer than the modal is wide wraps onto more lines, so
 * pass `width` (the list's width) or the scroll logic counts it as one line and clips the last rows.
 * Notes and provider headers are cut to one line, never wrapped.
 *
 * The text counted here mirrors what `SettingsItemRow` renders: cursor (2) + icon/label + value.
 */
export function itemRowHeight(item: SettingsItem, width?: number): number {
    if (item.kind === "sectionHeader" || item.kind === "subHeader") return 2;
    if (width === undefined) return 1;

    const available = width - ("indent" in item ? item.indent : 0);
    switch (item.kind) {
        case "checkbox":
            return wrappedLines(`${"  "}✔${"  "}${item.label}`, available);
        case "action":
            return wrappedLines(`${"  "}${item.label}`, available);
        // The label and the value are two `<Text>`s in a row: the value keeps its width, the label wraps in the rest.
        case "textInput":
            return wrappedLines(`${"  "}${item.label}: `, available - stringWidth(`[${item.get()}]`));
        case "select":
            return wrappedLines(`${"  "}${item.label}: `, available - stringWidth(`[${item.get()} ◀ ▶]`));
        default:
            return 1;
    }
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

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === "note") {
            if (result.includes(items[i - 1])) result.push(item);
            continue;
        }
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
