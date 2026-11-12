import type React from "react";
import { useRef } from "react";
import { useInput } from "ink";
import { shortcutRegistry } from "#base/shortcuts/ShortcutRegistry";
import { textInputFocus } from "#base/textInputFocus";
import { pasteRouter } from "#base/pasteRouter";
import { useImportActions } from "#contexts/ImportActionsContext";
import { useFocusChrome } from "#contexts/FocusContext";
import type { FocusableWindow } from "#hooks/useFocusManager";
import { detectUrls } from "./ImportModal/detectUrls";

const PASTE_DEBOUNCE_MS = 64;

/**
 * Windows that own the keyboard for their own purpose: a pasted link there is not an import request. (The
 * import modal itself is not listed: pasting more links while it is open adds them to it.)
 */
const NO_IMPORT_PASTE_WINDOWS: ReadonlySet<FocusableWindow> = new Set([
    "prompt",
    "settingsModal",
    "sessionsModal",
    "archiveModal",
    "startModal",
    "setupWizardModal",
    "welcomeModal",
    "updateModal",
    "confirmModal",
    "listDialog",
    "tempCleanupModal",
]);

/**
 * The single `useInput` in the application.
 * Handles the URL-paste special case then delegates everything else to the
 * central ShortcutRegistry (consume model: highest-priority active handler wins).
 */
export const ShortcutDispatcher: React.FC = () => {
    const { openImportFlow } = useImportActions();
    const { activeWindow } = useFocusChrome();
    const activeWindowRef = useRef(activeWindow);
    activeWindowRef.current = activeWindow; // eslint-disable-line react-hooks/refs
    const pasteBufferRef = useRef<string>("");
    const pasteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useInput((input, key) => {
        // Some terminals paste clipboard content directly into stdin as a
        // multi-character chunk. Detect link pastes and open the import flow
        // before normal shortcut routing.
        //
        // A focused text field keeps what is pasted into it: the text goes to the field alone.
        //
        // Large pastes arrive in multiple 1024-byte stdin chunks, so we buffer
        // incoming chunks and flush after a short idle window to guarantee
        // no URL is lost at a chunk boundary.
        const isPasteBufferActive = pasteBufferRef.current !== "";
        const isLinkPasteChunk = !isPasteBufferActive && input.length > 8 && detectUrls(input).length > 0;

        if ((isLinkPasteChunk && !textInputFocus.isFocused()) || isPasteBufferActive) {
            pasteBufferRef.current += input;
            if (pasteTimerRef.current) clearTimeout(pasteTimerRef.current);
            pasteTimerRef.current = setTimeout(() => {
                const text = pasteBufferRef.current;
                pasteBufferRef.current = "";
                pasteTimerRef.current = null;
                // Another window (Archive, Settings…) may be on top by now: the paste is dropped, not stacked under it.
                if (NO_IMPORT_PASTE_WINDOWS.has(activeWindowRef.current)) return;
                // A focused panel may have its own use for a pasted link ("add it to this track"): it goes first.
                if (pasteRouter.route(text)) return;
                openImportFlow(text);
            }, PASTE_DEBOUNCE_MS);
            return;
        }

        shortcutRegistry.dispatch(input, key);
    });

    return null;
};
