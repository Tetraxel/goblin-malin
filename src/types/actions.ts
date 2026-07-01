import React from "react";
import { Text, Key } from "ink";
import { Task } from "#base/task/task";

export type Shortcut = {
    key?: keyof Key;
    input?: string;
    /** F1=1 … F12=12. Matches terminal-specific escape sequences automatically. */
    funcKey?: number;
    ctrl?: boolean;
    shift?: boolean;
    meta?: boolean;
};

// xterm (VT100) sequences used by Windows Terminal, macOS Terminal, etc.
// Linux console sends \x1b[11~–\x1b[14~for F1–F4 instead of the \x1bO* forms.
const FUNC_KEY_SEQUENCES: Record<number, string[]> = {
    1: ["\x1bOP", "\x1b[11~"],
    2: ["\x1bOQ", "\x1b[12~"],
    3: ["\x1bOR", "\x1b[13~"],
    4: ["\x1bOS", "\x1b[14~"],
    5: ["\x1b[15~"],
    6: ["\x1b[17~"],
    7: ["\x1b[18~"],
    8: ["\x1b[19~"],
    9: ["\x1b[20~"],
    10: ["\x1b[21~"],
    11: ["\x1b[23~"],
    12: ["\x1b[24~"],
};

export type ContextualActions = {
    shortcuts: Shortcut[];
    label: string;
    description?: string;
    color?: React.ComponentProps<typeof Text>["color"];
    multiSelectAllowed?: boolean;
    multiSelectOnly?: boolean;
    onClick: () => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onClickBatch?: (tasks: Task<any>[]) => void;
};

// Request handed from a flow action to the React layer to ask the user how a
// task (or batch) should be started when its TAG?/DL? checkboxes are both off.
export type StartOptionsRequest = {
    taskCount: number;
    apply: (opts: { toTag: boolean; toDownload: boolean }) => void;
};

export type ActionBarRow = {
    text?: string;
    textColor?: React.ComponentProps<typeof Text>["color"];
    actions: ContextualActions[];
};

export type ContextualActionBar = {
    rows: ActionBarRow[];
};

/**
 * Registry id(s) for a flow's contextual action-bar shortcuts. This is the single
 * source of truth for the `taskList.contextual.*` id scheme — used both when
 * registering the shortcuts (useKeyHandlers) and when displaying their hints
 * (ActionBar), so the two never drift. Actions with multiple bindings get one id
 * per binding (`.0`, `.1`, …); single-binding actions get a bare slug.
 */
export function getContextualShortcutIds(action: ContextualActions): string[] {
    const slug = action.label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    return action.shortcuts.map((_, i) => `taskList.contextual.${slug}${action.shortcuts.length > 1 ? `.${i}` : ""}`);
}

// Friendly display labels for named keys. Anything not listed falls back to the
// raw key name uppercased.
const KEY_LABELS: Partial<Record<keyof Key, string>> = {
    return: "Enter",
    escape: "Esc",
    delete: "Del",
    backspace: "⌫",
    tab: "Tab",
    upArrow: "↑",
    downArrow: "↓",
    leftArrow: "←",
    rightArrow: "→",
    pageUp: "PgUp",
    pageDown: "PgDn",
    home: "Home",
    end: "End",
};

export function getShortcutLiteral(shortcuts: Shortcut[]): string {
    return shortcuts
        .map((shortcut) => {
            const modifiers: string[] = [];
            if (shortcut.ctrl) modifiers.push("Ctrl");
            if (shortcut.shift) modifiers.push("Shift");
            if (shortcut.meta) modifiers.push("Meta");
            const funcKeyName = shortcut.funcKey !== undefined ? `F${shortcut.funcKey}` : "";
            const keyName = shortcut.key ? (KEY_LABELS[shortcut.key] ?? shortcut.key.toUpperCase()) : "";
            const inputName = shortcut.input ? (shortcut.input === " " ? "Space" : shortcut.input.toUpperCase()) : "";
            const base = funcKeyName || keyName || inputName || "";
            return [...modifiers, base].filter(Boolean).join("+");
        })
        .join(" / ");
}

/**
 * Returns the function key number (1-12) for a raw escape sequence, or undefined
 * if the data isn't a function key. Used by ShortcutDispatcher's raw stdin listener
 * because Ink zeroes `input` for function keys before passing it to useInput handlers.
 */
export function detectFuncKey(rawData: string): number | undefined {
    for (const [numStr, seqs] of Object.entries(FUNC_KEY_SEQUENCES)) {
        if (seqs.includes(rawData)) return Number(numStr);
    }
    return undefined;
}

export function matchesShortcut(shortcut: Shortcut, input: string, key: Key): boolean {
    if (shortcut.input !== undefined) {
        // For character input, ctrl/meta must match; shift is optional.
        // When shift is unspecified, match case-insensitively so { input: "f" } fires on both f and Shift+F.
        if (shortcut.ctrl !== undefined && shortcut.ctrl !== key.ctrl) return false;
        if (shortcut.meta !== undefined && shortcut.meta !== key.meta) return false;
        if (shortcut.shift === undefined) {
            return shortcut.input.toLowerCase() === input.toLowerCase();
        }
        if (shortcut.shift !== key.shift) return false;
        return shortcut.input === input;
    }

    if (shortcut.key) {
        // For named keys, unspecified modifiers default to false — Shift+Left must not
        // accidentally trigger a plain { key: "leftArrow" } handler registered at higher priority.
        if ((shortcut.shift ?? false) !== key.shift) return false;
        if ((shortcut.ctrl ?? false) !== key.ctrl) return false;
        if ((shortcut.meta ?? false) !== key.meta) return false;
        const k = shortcut.key;
        return Boolean(
            (k === "upArrow" && key.upArrow) ||
            (k === "downArrow" && key.downArrow) ||
            (k === "leftArrow" && key.leftArrow) ||
            (k === "rightArrow" && key.rightArrow) ||
            (k === "pageDown" && key.pageDown) ||
            (k === "pageUp" && key.pageUp) ||
            (k === "home" && key.home) ||
            (k === "end" && key.end) ||
            (k === "return" && key.return) ||
            (k === "escape" && key.escape) ||
            (k === "tab" && key.tab) ||
            (k === "backspace" && key.backspace) ||
            (k === "delete" && key.delete)
        );
    }

    return false;
}
