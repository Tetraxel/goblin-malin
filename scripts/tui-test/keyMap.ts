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

    // Ctrl keys
    "Ctrl+A": "\x01",
    "Ctrl+C": "\x03",
    "Ctrl+D": "\x04",
    "Ctrl+N": "\x0e",
    "Ctrl+R": "\x12",
    "Ctrl+S": "\x13",
    "Ctrl+V": "\x16",

    // Navigation
    Home: "\x1b[H",
    End: "\x1b[F",
    PageUp: "\x1b[5~",
    PageDown: "\x1b[6~",
};

// Single characters (letters, digits, punctuation) pass through as-is via the fallback.
export function resolveKey(name: string): string {
    return KEY_MAP[name] ?? name;
}
