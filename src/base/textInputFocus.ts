/**
 * Whether a text field currently has the keyboard. Text fields (`#components/TextInput`) register here while
 * focused, so code that sits in front of them (the paste handler in `ShortcutDispatcher`) can leave typed and
 * pasted text to the field instead of acting on it.
 */
let focused = 0;

/** A Ctrl+letter key press is handled within the same tick as the raw chunk; this is the safety margin. */
const CONTROL_KEY_WINDOW_MS = 20;
let lastControlKeyAt = 0;

/** Ctrl+A…Z arrive as the single bytes 0x01–0x1A, except the ones that are keys of their own (Backspace, Tab, Enter). */
const isControlLetter = (code: number): boolean =>
    code >= 0x01 && code <= 0x1a && code !== 0x08 && code !== 0x09 && code !== 0x0a && code !== 0x0d;

export const textInputFocus = {
    /** Marks one field as focused; returns the function that releases it. */
    acquire(): () => void {
        focused++;
        let released = false;
        return () => {
            if (released) return;
            released = true;
            focused--;
        };
    },
    isFocused(): boolean {
        return focused > 0;
    },
    /** Called with every raw stdin chunk, before Ink reads it. */
    noteRawInput(chunk: string): void {
        if (chunk.length === 1 && isControlLetter(chunk.charCodeAt(0))) lastControlKeyAt = Date.now();
    },
    /**
     * True while a Ctrl+letter press is being delivered. `ink-text-input` types the letter for those (Ctrl+Q
     * would add a "q"), so fields drop the change: a shortcut is not text.
     */
    isControlKeyPress(): boolean {
        return Date.now() - lastControlKeyAt <= CONTROL_KEY_WINDOW_MS;
    },
};
