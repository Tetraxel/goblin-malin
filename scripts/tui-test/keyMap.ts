const KEY_MAP: Record<string, string> = {
    // Basic keys
    Enter: "\r",
    Return: "\r",
    Escape: "\x1b",
    Esc: "\x1b",
    Tab: "\t",
    "Shift+Tab": "\x1b[Z",
    Space: " ",
    Backspace: "\x7f",
    Delete: "\x1b[3~",
    Del: "\x1b[3~",

    // Arrow keys
    ArrowUp: "\x1b[A",
    Up: "\x1b[A",
    "↑": "\x1b[A",
    ArrowDown: "\x1b[B",
    Down: "\x1b[B",
    "↓": "\x1b[B",
    ArrowRight: "\x1b[C",
    Right: "\x1b[C",
    "→": "\x1b[C",
    ArrowLeft: "\x1b[D",
    Left: "\x1b[D",
    "←": "\x1b[D",

    // Shift+Arrow keys
    "Shift+ArrowUp": "\x1b[1;2A",
    "Shift+↑": "\x1b[1;2A",
    "Shift+ArrowDown": "\x1b[1;2B",
    "Shift+↓": "\x1b[1;2B",
    "Shift+ArrowRight": "\x1b[1;2C",
    "Shift+→": "\x1b[1;2C",
    "Shift+ArrowLeft": "\x1b[1;2D",
    "Shift+←": "\x1b[1;2D",

    // Ctrl+Shift+Arrow keys (extend the task selection)
    "Ctrl+Shift+ArrowUp": "\x1b[1;6A",
    "Ctrl+Shift+↑": "\x1b[1;6A",
    "Ctrl+Shift+ArrowDown": "\x1b[1;6B",
    "Ctrl+Shift+↓": "\x1b[1;6B",

    // Ctrl keys
    "Ctrl+A": "\x01",
    "Ctrl+C": "\x03",
    "Ctrl+D": "\x04",
    "Ctrl+G": "\x07",
    "Ctrl+L": "\x0c",
    "Ctrl+N": "\x0e",
    "Ctrl+O": "\x0f",
    "Ctrl+Q": "\x11",
    "Ctrl+R": "\x12",
    "Ctrl+S": "\x13",
    "Ctrl+T": "\x14",
    "Ctrl+V": "\x16",
    "Ctrl+Z": "\x1a",

    // Navigation
    Home: "\x1b[H",
    End: "\x1b[F",
    PageUp: "\x1b[5~",
    PageDown: "\x1b[6~",
};

const CURSOR_FINAL: Record<string, string> = {
    up: "A",
    arrowup: "A",
    down: "B",
    arrowdown: "B",
    right: "C",
    arrowright: "C",
    left: "D",
    arrowleft: "D",
    home: "H",
    end: "F",
    "↑": "A",
    "↓": "B",
    "→": "C",
    "←": "D",
};
const TILDE_CODE: Record<string, number> = { insert: 2, delete: 3, del: 3, pageup: 5, pagedown: 6 };
/** F5..F12 are `ESC [ n ~` with these numbers (F1..F4 are `ESC O P..S`). */
const FUNCTION_TILDE: Record<number, number> = { 5: 15, 6: 17, 7: 18, 8: 19, 9: 20, 10: 21, 11: 23, 12: 24 };
const FUNCTION_SS3 = ["P", "Q", "R", "S"];
const ESC = "\u001b";

/** `1 + shift(1) + alt(2) + ctrl(4)`: the number xterm puts after the `;` of a modified key. */
const modifierParam = (shift: boolean, alt: boolean, ctrl: boolean): number =>
    1 + (shift ? 1 : 0) + (alt ? 2 : 0) + (ctrl ? 4 : 0);

/** What a terminal sends for Ctrl + a character (letters, `[ \ ] ^ _ @`, Space), or undefined. */
function controlChar(ch: string): string | undefined {
    if (ch === " " || ch === "@") return "\u0000";
    if (/^[a-z]$/i.test(ch)) return String.fromCharCode(ch.toLowerCase().charCodeAt(0) - 96);
    if ("[\\]^_".includes(ch)) return String.fromCharCode(ch.charCodeAt(0) - 64);
    return undefined;
}

/**
 * A key with modifiers written out (`Ctrl+←`, `Alt+x`, `Ctrl+Shift+F5`, `Ctrl+B`) as the escape sequence an
 * xterm-like terminal sends. Undefined when the name is not a key with modifiers.
 */
function resolveModified(name: string): string | undefined {
    // "Ctrl++" is Ctrl and the plus key.
    const parts = name.endsWith("++") ? [...name.slice(0, -2).split("+"), "+"] : name.split("+");
    if (parts.length < 2) return undefined;
    const key = parts.pop()!;
    let shift = false;
    let alt = false;
    let ctrl = false;
    for (const mod of parts) {
        const m = mod.toLowerCase();
        if (m === "shift") shift = true;
        else if (m === "alt" || m === "meta" || m === "option") alt = true;
        else if (m === "ctrl" || m === "control") ctrl = true;
        else return undefined;
    }
    const lower = key.toLowerCase();
    const param = modifierParam(shift, alt, ctrl);

    const cursor = CURSOR_FINAL[lower] ?? CURSOR_FINAL[key];
    if (cursor) return `${ESC}[1;${param}${cursor}`;
    const tilde = TILDE_CODE[lower];
    if (tilde) return `${ESC}[${tilde};${param}~`;
    const fn = /^f(\d{1,2})$/.exec(lower);
    if (fn) {
        const n = Number(fn[1]);
        if (n >= 1 && n <= 4) return `${ESC}[1;${param}${FUNCTION_SS3[n - 1]}`;
        const code = FUNCTION_TILDE[n];
        return code ? `${ESC}[${code};${param}~` : undefined;
    }

    // Plain keys: Shift+Tab is its own sequence; Ctrl turns a letter into a control code; Alt puts an Escape first.
    let out: string | undefined;
    if (lower === "tab") out = shift ? `${ESC}[Z` : "\t";
    else if (lower === "enter" || lower === "return") out = "\r";
    else if (lower === "esc" || lower === "escape") out = ESC;
    else if (lower === "space") out = ctrl ? "\u0000" : " ";
    else if (lower === "backspace") out = ctrl ? "\b" : "\u007f";
    else if (key.length === 1) out = ctrl ? controlChar(key) : shift ? key.toUpperCase() : key;
    if (out === undefined) return undefined;
    return alt ? ESC + out : out;
}

/**
 * The bytes a key name stands for. Names in the table above first; then any modifier combination (`Ctrl+←`,
 * `Alt+Enter`, `Ctrl+Shift+F5`, `Ctrl+B`); then the bare function keys and Insert; anything else is typed as it is
 * (a single character). A name with a modifier that cannot be read is an error, so a typo is not typed into the app.
 */
export function resolveKey(name: string): string {
    const known = KEY_MAP[name];
    if (known !== undefined) return known;
    const modified = resolveModified(name);
    if (modified !== undefined) return modified;
    const fn = /^F(\d{1,2})$/i.exec(name);
    if (fn) {
        const n = Number(fn[1]);
        if (n >= 1 && n <= 4) return `${ESC}O${FUNCTION_SS3[n - 1]}`;
        const code = FUNCTION_TILDE[n];
        if (code) return `${ESC}[${code}~`;
    }
    if (name.toLowerCase() === "insert") return `${ESC}[2~`;
    if (name.length > 1 && /^(ctrl|alt|shift|meta|option|control)\+/i.test(name)) {
        throw new Error(`Unknown key "${name}"`);
    }
    return name;
}

/** Bracketed paste: what a terminal sends around pasted text when the app asked for it (`ESC [ ? 2004 h`). */
export function bracketedPaste(text: string): string {
    return `${ESC}[200~${text}${ESC}[201~`;
}
