import React from "react";
import { Text, Key } from "ink";
import { Task } from "#base/task/task";

export type Shortcut = {
    key?: keyof Key;
    input?: string;
    ctrl?: boolean;
    shift?: boolean;
    meta?: boolean;
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

export type ActionBarRow = {
    text?: string;
    textColor?: React.ComponentProps<typeof Text>["color"];
    actions: ContextualActions[];
};

export type ContextualActionBar = {
    rows: ActionBarRow[];
};

export function getShortcutLiteral(shortcuts: Shortcut[]): string {
    return shortcuts
        .map((shortcut) => {
            const modifiers: string[] = [];
            if (shortcut.ctrl) modifiers.push("Ctrl");
            if (shortcut.shift) modifiers.push("Shift");
            if (shortcut.meta) modifiers.push("Meta");
            const keyName = shortcut.key ? shortcut.key.toUpperCase() : "";
            const inputName = shortcut.input ? (shortcut.input === " " ? "SPACE" : shortcut.input.toUpperCase()) : "";
            const base = keyName || inputName || "";
            return [...modifiers, base].filter(Boolean).join("+");
        })
        .join(" / ");
}

export function matchesShortcut(shortcut: Shortcut, input: string, key: Key): boolean {
    if (shortcut.ctrl !== undefined && shortcut.ctrl !== key.ctrl) return false;
    if (shortcut.shift !== undefined && shortcut.shift !== key.shift) return false;
    if (shortcut.meta !== undefined && shortcut.meta !== key.meta) return false;

    if (shortcut.input !== undefined) {
        return shortcut.input === input;
    }

    if (shortcut.key) {
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
