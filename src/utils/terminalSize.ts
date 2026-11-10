/** Smallest terminal the main layout stays readable in (columns × rows). Below it the toolbar scrolls off and columns jam together. */
export const MIN_TERMINAL_WIDTH = 66;
export const MIN_TERMINAL_HEIGHT = 16;

/** True when the terminal is smaller than the main layout supports. An unknown size (no TTY) is never "too small". */
export function isTerminalTooSmall(width: number | undefined, height: number | undefined): boolean {
    return (width ?? Infinity) < MIN_TERMINAL_WIDTH || (height ?? Infinity) < MIN_TERMINAL_HEIGHT;
}

/** The message shown instead of the interface. */
export function terminalTooSmallMessage(width: number, height: number): string {
    return `▵ Terminal too small : need at least ${MIN_TERMINAL_WIDTH}×${MIN_TERMINAL_HEIGHT} (now ${width}×${height})`;
}
