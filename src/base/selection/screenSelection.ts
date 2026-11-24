/**
 * Select with the mouse, and the text is on the clipboard.
 *
 * The terminal's own selection is off while the app has mouse reporting on (it needs it for clicks and the wheel), so
 * the app does it: a drag with the left button highlights the cells under it, and letting go copies what they hold,
 * whatever it is (the task list, a log line, a dialog). A plain click is still only a click. Alt+drag selects a
 * rectangle. The highlight stays until the next click, key or wheel notch.
 *
 * The screen is read back from the patched Ink (`screenTap.ts`) and the highlight is painted by it, so what is
 * selected is what is on screen, modals and all.
 */
import { globalLogger } from "#base/logger/logger";
import { mouseRegistry, type MouseEvent } from "#base/mouse/mouse";
import { SettingsStore } from "#settings/settingsStore";
import { copyToClipboard } from "./clipboardWrite";
import { clampPoint, highlightRow, isPaneLimit, paneBounds, selectedText, type Selection } from "./selection";
import { getScreenTap } from "./screenTap";

/**
 * The most often a drag repaints the screen. The terminal reports every cell the pointer enters (any-motion tracking),
 * and every React commit repaints the whole screen, so painting each of them made a drag crawl; the highlight follows
 * the pointer at this pace and the release always paints the final one.
 */
const DRAG_PAINT_INTERVAL_MS = 50;

type Pressed = { anchor: { x: number; y: number }; block: boolean; bounds: { left: number; right: number } };

class ScreenSelection {
    private pressed: Pressed | undefined;
    private selection: Selection | undefined;
    private version = 0;
    private lastPublishedAt = 0;
    private publishTimer: ReturnType<typeof setTimeout> | undefined;
    private readonly listeners = new Set<() => void>();

    /** The selection on screen, if any. */
    get current(): Selection | undefined {
        return this.selection;
    }

    /** Changes with every change of the selection: what a component follows to repaint. */
    getVersion = (): number => this.version;

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };

    /** Starts listening to the mouse and to the terminal changing size. Returns the way back. */
    install(): () => void {
        const stopMouse = mouseRegistry.subscribe((event) => this.handleMouse(event));
        const onResize = () => this.clear();
        process.stdout.on("resize", onResize);
        return () => {
            stopMouse();
            process.stdout.off("resize", onResize);
            this.clear();
        };
    }

    /** Removes the highlight (and abandons a drag in progress). */
    clear(): void {
        this.pressed = undefined;
        if (!this.selection) return;
        this.selection = undefined;
        this.publish();
    }

    handleMouse(event: MouseEvent): void {
        if (event.button === "wheelUp" || event.button === "wheelDown") {
            // The content moves under the highlight: it would point at other text.
            this.clear();
            return;
        }
        if (event.type === "press") {
            this.clear();
            if (event.button === "left") this.begin(event);
            return;
        }
        const pressed = this.pressed;
        if (!pressed) return;
        if (event.type === "move") {
            // A release the terminal never told us about (the pointer left its window): the drag is over.
            if (event.button !== "left") this.finish();
            else this.drag(pressed, event);
            return;
        }
        if (event.button === "left") {
            this.drag(pressed, event);
            this.finish();
        }
    }

    private begin(event: MouseEvent): void {
        // Ctrl / Shift + click is the task list's multi-select, not the start of a selection.
        if (event.ctrl || event.shift || !SettingsStore.getInstance().getAppSettings().general.copyOnSelect) return;
        const frame = getScreenTap().frame;
        const row = frame[event.y];
        if (!row) return;
        // A press on a border (its side, or the corner / tee where it starts) is a handle (the chat's edge), not text:
        // the pane around it would be empty.
        if (isPaneLimit(frame, event.x, event.y)) return;
        this.pressed = {
            anchor: { x: event.x, y: event.y },
            block: event.alt,
            bounds: paneBounds(frame, event.x, event.y),
        };
    }

    private drag(pressed: Pressed, event: MouseEvent): void {
        const frame = getScreenTap().frame;
        const focus = clampPoint({ x: event.x, y: event.y }, pressed.bounds, frame.length);
        const previous = this.selection;
        // The pointer is still on the cell it went down on: that is a click, not a selection.
        if (!previous && focus.x === pressed.anchor.x && focus.y === pressed.anchor.y) return;
        if (previous && previous.focus.x === focus.x && previous.focus.y === focus.y) return;
        this.selection = { anchor: pressed.anchor, focus, block: pressed.block, bounds: pressed.bounds };
        this.publishPaced();
    }

    /** `publish()`, but at most once per `DRAG_PAINT_INTERVAL_MS`: the first at once, the others after the wait. */
    private publishPaced(): void {
        const wait = this.lastPublishedAt + DRAG_PAINT_INTERVAL_MS - Date.now();
        if (wait <= 0) {
            this.publish();
            return;
        }
        // The timer reads the selection when it fires, so a pointer that moved on meanwhile is painted where it is.
        this.publishTimer ??= setTimeout(() => this.publish(), wait);
    }

    private finish(): void {
        this.pressed = undefined;
        const selection = this.selection;
        if (!selection) return;
        const text = selectedText(getScreenTap().frame, selection);
        // Blank cells: nothing worth taking the clipboard away from the user for.
        if (text.trim() === "") {
            this.clear();
            return;
        }
        // The highlight the user let go of is the last pointer position, not the last one that was painted.
        if (this.publishTimer) this.publish();
        void copyToClipboard(text).then((copied) => {
            if (copied) globalLogger.info(`Copied ${describeCopy(text)} to the clipboard`);
            else globalLogger.warn(`Could not copy ${describeCopy(text)}: no clipboard took it`);
        });
    }

    private publish(): void {
        clearTimeout(this.publishTimer);
        this.publishTimer = undefined;
        this.lastPublishedAt = Date.now();
        const tap = getScreenTap();
        const selection = this.selection;
        tap.highlight = selection ? (y, row) => highlightRow(selection, y, row) : undefined;
        this.version++;
        for (const listener of [...this.listeners]) listener();
    }
}

function describeCopy(text: string): string {
    const lines = text.split("\n").length;
    const characters = [...text].length;
    return lines > 1 ? `${lines} lines (${characters} characters)` : `${characters} characters`;
}

export const screenSelection = new ScreenSelection();
