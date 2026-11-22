import stringWidth from "string-width";
import wrapAnsi from "wrap-ansi";

/**
 * One row of the settings list. Every row that is not a header is drawn the same way (`SettingsItemRow`):
 * `indent`, the cursor (2 columns), an icon (1 glyph + 2 spaces), the label, then the value. The icon column is
 * always there, so the labels of a block line up whatever their kind: a row without an icon of its own gets its
 * kind's (`ITEM_ICONS`). `icon` replaces it (⌂ for a folder, ✕ for something that deletes).
 */
export type SettingsItem =
    | { kind: "sectionHeader"; label: string }
    | { kind: "subHeader"; label: string }
    | { kind: "providerHeader"; label: string; color: string; missingCredentials?: boolean }
    | { kind: "checkbox"; label: string; indent: number; get: () => boolean; set: (v: boolean) => void }
    | {
          kind: "textInput";
          label: string;
          indent: number;
          icon?: string;
          get: () => string;
          set: (v: string) => void;
      }
    | {
          kind: "select";
          label: string;
          indent: number;
          icon?: string;
          options: readonly string[];
          get: () => string;
          set: (v: string) => void;
      }
    | { kind: "action"; label: string; indent: number; icon?: string; run: () => void }
    | { kind: "readonlyText"; label: string; indent: number; icon?: string; value: string }
    /** A dim line of information under the row above it (never selectable). It stays with that row when searching. */
    | { kind: "note"; indent: number; text: string };

/** The icon of a row that names none, by kind (a checkbox shows its box instead). */
export const ITEM_ICONS = { textInput: "✎", select: "≡", action: "›", readonlyText: "·" } as const;

/** Columns before a row's label: cursor (2) + icon (1) + gap (2). A note lines up with the label above it. */
export const LABEL_OFFSET = 5;
/** Columns between a label's column and its value. */
export const VALUE_GAP = 2;

export function isInteractive(item: SettingsItem): boolean {
    return item.kind === "checkbox" || item.kind === "textInput" || item.kind === "select" || item.kind === "action";
}

/** Whether a row shows a value after its label (in the value column of its block). */
export function hasValue(
    item: SettingsItem
): item is Extract<SettingsItem, { kind: "textInput" | "select" | "readonlyText" }> {
    return item.kind === "textInput" || item.kind === "select" || item.kind === "readonlyText";
}

/** The value a row shows, as text (what its width is counted from). */
export function valueText(item: SettingsItem): string {
    if (item.kind === "select") return `◀ ${item.get()} ▶`;
    if (item.kind === "textInput") return `[ ${item.get() || "empty"} ]`;
    if (item.kind === "readonlyText") return item.value;
    return "";
}

/**
 * The width of the label column of each row that has a value, so the values of a block (the rows between two
 * headers, at the same indent) start in one column. A label longer than half the row keeps its own width and pushes
 * its value right: aligning on it would leave the others' values far from their labels.
 */
export function valueColumns(items: SettingsItem[], width: number): Map<number, number> {
    const result = new Map<number, number>();
    let block: number[] = [];
    const flush = () => {
        const byIndent = new Map<number, number[]>();
        for (const i of block) {
            const indent = (items[i] as { indent: number }).indent;
            byIndent.set(indent, [...(byIndent.get(indent) ?? []), i]);
        }
        for (const [indent, rows] of byIndent) {
            const cap = Math.floor((width - indent - LABEL_OFFSET) / 2);
            const fitting = rows.map((i) => stringWidth((items[i] as { label: string }).label)).filter((w) => w <= cap);
            const column = fitting.length > 0 ? Math.max(...fitting) : 0;
            for (const i of rows) {
                const own = stringWidth((items[i] as { label: string }).label);
                result.set(i, own <= cap ? column : own);
            }
        }
        block = [];
    };
    items.forEach((item, i) => {
        if (item.kind === "sectionHeader" || item.kind === "subHeader" || item.kind === "providerHeader") flush();
        else if (hasValue(item)) block.push(i);
    });
    flush();
    return result;
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
 * The text counted here mirrors what `SettingsItemRow` renders: cursor + icon (`LABEL_OFFSET`), the label, and for a
 * row with a value the label's column (`labelWidth`, see `valueColumns`) + a gap + the value.
 */
export function itemRowHeight(item: SettingsItem, width?: number, labelWidth?: number): number {
    if (item.kind === "sectionHeader" || item.kind === "subHeader") return 2;
    if (width === undefined) return 1;

    const available = width - ("indent" in item ? item.indent : 0) - LABEL_OFFSET;
    switch (item.kind) {
        case "checkbox":
        case "action":
            return wrappedLines(item.label, available);
        // The label and the value sit side by side: the value keeps its width, the label wraps in its column.
        case "textInput":
        case "select": {
            const room = available - VALUE_GAP - stringWidth(valueText(item));
            return wrappedLines(item.label, Math.max(1, Math.min(labelWidth ?? room, room)));
        }
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

    // Notes written right under a header ("Uses links from: …" under a provider) belong to it: the header is only
    // kept once a row below it matches, so they are kept with it, right after it.
    const headerNotes = new Map<SettingsItem, SettingsItem[]>();
    let lastHeader: SettingsItem | null = null;
    const pushHeader = (header: SettingsItem | null) => {
        if (!header || result.includes(header)) return;
        result.push(header);
        result.push(...(headerNotes.get(header) ?? []));
    };

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === "note") {
            if (lastHeader) headerNotes.set(lastHeader, [...(headerNotes.get(lastHeader) ?? []), item]);
            else if (result.includes(items[i - 1])) result.push(item);
            continue;
        }
        if (item.kind === "sectionHeader") {
            pendingSection = item;
            pendingSubHeader = null;
            pendingProvider = null;
            lastHeader = item;
            continue;
        }
        if (item.kind === "subHeader") {
            pendingSubHeader = item;
            pendingProvider = null;
            lastHeader = item;
            continue;
        }
        if (item.kind === "providerHeader") {
            pendingProvider = item;
            lastHeader = item;
            continue;
        }
        lastHeader = null;

        const selfLabel = "label" in item ? item.label.toLowerCase() : "";
        const sectionLbl = pendingSection && "label" in pendingSection ? pendingSection.label.toLowerCase() : "";
        const subLbl = pendingSubHeader && "label" in pendingSubHeader ? pendingSubHeader.label.toLowerCase() : "";
        const providerLbl = pendingProvider && "label" in pendingProvider ? pendingProvider.label.toLowerCase() : "";

        const matches =
            selfLabel.includes(q) || sectionLbl.includes(q) || subLbl.includes(q) || providerLbl.includes(q);

        if (matches) {
            pushHeader(pendingSection);
            pushHeader(pendingSubHeader);
            pushHeader(pendingProvider);
            result.push(item);
        }
    }

    return result;
}
