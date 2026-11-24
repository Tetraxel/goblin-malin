/**
 * Mouse reports as a terminal sends them (SGR mode, `ESC [ < button ; column ; row M|m`, columns and rows 1-based),
 * so a scenario says "click here" instead of spelling escape sequences.
 */

export type MouseButton = "left" | "middle" | "right";

export interface MouseModifiers {
    shift?: boolean;
    alt?: boolean;
    ctrl?: boolean;
}

export interface Point {
    col: number;
    row: number;
}

const BUTTON: Record<MouseButton, number> = { left: 0, middle: 1, right: 2 };

function code(button: number, mods: MouseModifiers, motion = false): number {
    return button + (mods.shift ? 4 : 0) + (mods.alt ? 8 : 0) + (mods.ctrl ? 16 : 0) + (motion ? 32 : 0);
}

const report = (c: number, at: Point, final: "M" | "m"): string => `\u001b[<${c};${at.col};${at.row}${final}`;

export function mousePress(at: Point, button: MouseButton = "left", mods: MouseModifiers = {}): string {
    return report(code(BUTTON[button], mods), at, "M");
}

export function mouseRelease(at: Point, button: MouseButton = "left", mods: MouseModifiers = {}): string {
    return report(code(BUTTON[button], mods), at, "m");
}

/** The pointer moving with a button held. */
export function mouseDragTo(at: Point, button: MouseButton = "left", mods: MouseModifiers = {}): string {
    return report(code(BUTTON[button], mods, true), at, "M");
}

export function mouseWheel(at: Point, direction: "up" | "down", mods: MouseModifiers = {}): string {
    return report(code(direction === "up" ? 64 : 65, mods), at, "M");
}

/** Press, a motion event per cell on the way (at most `maxSteps`), release: what a drag looks like to the app. */
export function mouseDrag(
    from: Point,
    to: Point,
    button: MouseButton = "left",
    mods: MouseModifiers = {},
    maxSteps = 40
): string[] {
    const events = [mousePress(from, button, mods)];
    const distance = Math.max(Math.abs(to.col - from.col), Math.abs(to.row - from.row));
    const steps = Math.min(Math.max(distance, 1), maxSteps);
    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        events.push(
            mouseDragTo(
                {
                    col: Math.round(from.col + (to.col - from.col) * t),
                    row: Math.round(from.row + (to.row - from.row) * t),
                },
                button,
                mods
            )
        );
    }
    events.push(mouseRelease(to, button, mods));
    return events;
}

/** The pointer moving with no button down (what makes hover effects happen). */
export function mouseMove(at: Point, mods: MouseModifiers = {}): string {
    return report(code(3, mods, true), at, "M");
}
