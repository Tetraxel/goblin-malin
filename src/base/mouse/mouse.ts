/**
 * Terminal mouse support (xterm SGR mouse reporting).
 *
 * Ink has no pointer handling, so we turn on the terminal's mouse tracking
 * ourselves, pull the report sequences out of stdin before Ink sees them (it would
 * otherwise deliver them to `useInput` as garbage text), and fan them out to
 * subscribers through `mouseRegistry`.
 */

const ESC = "\u001b";

/**
 * Any-event tracking (1003: press/release plus motion, with or without a button held) with
 * SGR encoding (1006), which has no 223-column limit. 1003 is what makes hover possible.
 */
export const ENABLE_MOUSE = `${ESC}[?1003h${ESC}[?1006h`;
export const DISABLE_MOUSE = `${ESC}[?1006l${ESC}[?1003l`;

/** `none` is only seen on `move` events (pointer moving with no button held). */
export type MouseButton = "left" | "middle" | "right" | "wheelUp" | "wheelDown" | "none";

export type MouseEvent = {
    type: "press" | "release" | "move";
    button: MouseButton;
    /** 0-based screen column. */
    x: number;
    /** 0-based screen row. */
    y: number;
    ctrl: boolean;
    shift: boolean;
    alt: boolean;
};

// ESC [ < button ; column ; row (M = press, m = release). Coordinates are 1-based.
const SGR_MOUSE = new RegExp(`${ESC}\\[<(\\d+);(\\d+);(\\d+)([Mm])`, "g");

const SHIFT_BIT = 4;
const ALT_BIT = 8;
const CTRL_BIT = 16;
const MOTION_BIT = 32;
const WHEEL_BIT = 64;

function decodeButton(code: number): MouseButton | undefined {
    const base = code & 3;
    if (code & MOTION_BIT) return base === 0 ? "left" : base === 1 ? "middle" : base === 2 ? "right" : "none";
    if (code & WHEEL_BIT) return base === 0 ? "wheelUp" : base === 1 ? "wheelDown" : undefined;
    return base === 0 ? "left" : base === 1 ? "middle" : base === 2 ? "right" : undefined;
}

/**
 * Splits `data` into the mouse events it contains and whatever else was in the
 * chunk (keystrokes typed in the same read), which must still reach Ink.
 */
export function extractMouseEvents(data: string): { events: MouseEvent[]; rest: string } {
    const events: MouseEvent[] = [];
    const rest = data.replace(SGR_MOUSE, (_match, code, column, row, final) => {
        const codeNum = Number(code);
        const button = decodeButton(codeNum);
        if (button) {
            events.push({
                type: codeNum & MOTION_BIT ? "move" : final === "M" ? "press" : "release",
                button,
                x: Number(column) - 1,
                y: Number(row) - 1,
                ctrl: (codeNum & CTRL_BIT) !== 0,
                shift: (codeNum & SHIFT_BIT) !== 0,
                alt: (codeNum & ALT_BIT) !== 0,
            });
        }
        return "";
    });
    return { events, rest };
}

type MouseListener = (event: MouseEvent) => void;

class MouseRegistry {
    private listeners = new Set<MouseListener>();
    private lastMoveCell: { x: number; y: number } | undefined;

    subscribe(listener: MouseListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    dispatch(event: MouseEvent): void {
        // Terminals report every motion, often several per cell — only a change of cell is news.
        if (event.type === "move") {
            const last = this.lastMoveCell;
            if (last && last.x === event.x && last.y === event.y) return;
            this.lastMoveCell = { x: event.x, y: event.y };
        }
        for (const listener of [...this.listeners]) listener(event);
    }
}

export const mouseRegistry = new MouseRegistry();
