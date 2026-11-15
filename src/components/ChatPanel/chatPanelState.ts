import { useSyncExternalStore } from "react";
import { globalLogger } from "#base/logger/logger";
import { MIN_TERMINAL_WIDTH } from "#utils/terminalSize";
import { SettingsStore } from "#settings/settingsStore";
import { getMusicSettings } from "#flows/musicDownloadFlow/settings";

const logger = globalLogger.createChild({ service: "ChatPanel" });

/** The chat's colour: Claude's own, used for its title and prompt. */
export const CHAT_AGENT_COLOR = "#d97757";

/** Columns of the docked chat panel (border included) until the user resizes it. */
export const CHAT_PANEL_WIDTH = 42;
/** The narrowest the panel can be made: below this a line holds too few words to read. */
export const CHAT_PANEL_MIN_WIDTH = 30;
/** The widest it can be made, whatever the terminal. */
export const CHAT_PANEL_MAX_WIDTH = 120;
/** Columns one press of the resize shortcut moves the panel's edge. */
export const CHAT_PANEL_WIDTH_STEP = 4;

/**
 * Terminal width from which the chat sits at the right of the task list: the smallest main layout plus the panel.
 * Narrower, it opens as a window over the screen instead (a panel below would eat rows from the 16-row minimum).
 */
export const CHAT_DOCK_MIN_WIDTH = MIN_TERMINAL_WIDTH + CHAT_PANEL_WIDTH;

export const isChatDocked = (terminalWidth: number): boolean => terminalWidth >= CHAT_DOCK_MIN_WIDTH;

/** The widest the docked panel can be in this terminal: the task list keeps at least its smallest layout. */
export const maxChatWidth = (terminalWidth: number): number =>
    Math.max(CHAT_PANEL_MIN_WIDTH, Math.min(CHAT_PANEL_MAX_WIDTH, terminalWidth - MIN_TERMINAL_WIDTH));

/** The width to draw: what the user chose, kept inside what the terminal allows. */
export const clampChatWidth = (width: number, terminalWidth: number): number =>
    Math.max(CHAT_PANEL_MIN_WIDTH, Math.min(Math.round(width), maxChatWidth(terminalWidth)));

/** Whether the chat is shown at all. The conversation itself lives in `chatStore`, so closing it loses nothing. */
let open = false;
/** The width the user chose (kept in Settings, so it is the same next launch). `undefined` until it is first read. */
let preferredWidth: number | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const notify = (): void => listeners.forEach((l) => l());

function readSavedWidth(): number {
    try {
        const saved = getMusicSettings().agent?.panelWidth;
        if (typeof saved === "number" && Number.isFinite(saved)) {
            return Math.max(CHAT_PANEL_MIN_WIDTH, Math.min(CHAT_PANEL_MAX_WIDTH, Math.round(saved)));
        }
    } catch {
        // Settings not loaded (a test, a harness): the default does.
    }
    return CHAT_PANEL_WIDTH;
}

/**
 * What the user was doing in the panel: the half-typed message and how far back they scrolled. The panel is a
 * different element when docked and as a window (and unmounted while closed), so a resize across the dock width, or
 * closing and opening it, remounts it: it starts from this instead of from nothing. A plain object the panel writes to
 * from an effect (no subscription): only the panel itself reads it, at mount.
 */
export const chatViewMemory = { draft: "", scroll: 0 };

export const chatPanelState = {
    isOpen: (): boolean => open,
    setOpen(next: boolean): void {
        if (open === next) return;
        open = next;
        notify();
    },
    toggle(): void {
        this.setOpen(!open);
    },
    /** The width the user chose, before it is fitted to the terminal. */
    getWidth(): number {
        preferredWidth ??= readSavedWidth();
        return preferredWidth;
    },
    /** Resizes the panel. A drag calls this for every cell, so the choice is saved a moment later, once. */
    setWidth(next: number): void {
        const width = Math.max(CHAT_PANEL_MIN_WIDTH, Math.min(CHAT_PANEL_MAX_WIDTH, Math.round(next)));
        if (width === this.getWidth()) return;
        preferredWidth = width;
        notify();
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            try {
                SettingsStore.getInstance().patchMusicSettings({ agent: { panelWidth: width } });
            } catch (error) {
                logger.warn(`Could not save the chat panel width: ${(error as Error).message}`);
            }
        }, 600);
        saveTimer.unref?.();
    },
    subscribe(listener: () => void): () => void {
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    },
    /** For tests: forget the choice and the open state. */
    reset(): void {
        open = false;
        chatViewMemory.draft = "";
        chatViewMemory.scroll = 0;
        preferredWidth = undefined;
        clearTimeout(saveTimer);
        notify();
    },
};

export function useChatOpen(): boolean {
    return useSyncExternalStore(chatPanelState.subscribe, chatPanelState.isOpen);
}

/** The width the user chose for the docked panel (fit it to the terminal with {@link clampChatWidth}). */
export function useChatWidth(): number {
    return useSyncExternalStore(chatPanelState.subscribe, () => chatPanelState.getWidth());
}
