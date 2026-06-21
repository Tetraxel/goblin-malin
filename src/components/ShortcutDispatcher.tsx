import React, { useRef } from "react";
import { useInput } from "ink";
import { shortcutRegistry } from "#base/shortcuts/ShortcutRegistry";
import { useImportActions } from "#contexts/ImportActionsContext";

const PASTE_DEBOUNCE_MS = 64;

/**
 * The single `useInput` in the application.
 * Handles the URL-paste special case then delegates everything else to the
 * central ShortcutRegistry (consume model: highest-priority active handler wins).
 */
export const ShortcutDispatcher: React.FC = () => {
    const { openImportFlow } = useImportActions();
    const pasteBufferRef = useRef<string>("");
    const pasteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useInput((input, key) => {
        // Some terminals paste clipboard content directly into stdin as a
        // multi-character chunk. Detect URL pastes and open the import flow
        // before normal shortcut routing so they work even inside modals.
        //
        // Large pastes arrive in multiple 1024-byte stdin chunks, so we buffer
        // incoming chunks and flush after a short idle window to guarantee
        // no URL is lost at a chunk boundary.
        const isUrlPasteChunk = input.length > 8 && /https?:\/\//i.test(input);
        const isPasteBufferActive = pasteBufferRef.current !== "";

        if (isUrlPasteChunk || isPasteBufferActive) {
            pasteBufferRef.current += input;
            if (pasteTimerRef.current) clearTimeout(pasteTimerRef.current);
            pasteTimerRef.current = setTimeout(() => {
                const text = pasteBufferRef.current;
                pasteBufferRef.current = "";
                pasteTimerRef.current = null;
                openImportFlow(text);
            }, PASTE_DEBOUNCE_MS);
            return;
        }

        shortcutRegistry.dispatch(input, key);
    });

    return null;
};
