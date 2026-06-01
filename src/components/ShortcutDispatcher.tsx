import React from "react";
import { useInput } from "ink";
import { shortcutRegistry } from "#base/shortcuts/ShortcutRegistry";
import { useImportActions } from "#contexts/ImportActionsContext";

/**
 * The single `useInput` in the application.
 * Handles the URL-paste special case then delegates everything else to the
 * central ShortcutRegistry (consume model: highest-priority active handler wins).
 */
export const ShortcutDispatcher: React.FC = () => {
    const { openImportFlow } = useImportActions();

    useInput((input, key) => {
        // Some terminals paste clipboard content directly into stdin as a
        // multi-character chunk. Detect URL pastes and open the import flow
        // before normal shortcut routing so they work even inside modals.
        if (input.length > 8 && /https?:\/\//i.test(input)) {
            openImportFlow(input);
            return;
        }

        shortcutRegistry.dispatch(input, key);
    });

    return null;
};
