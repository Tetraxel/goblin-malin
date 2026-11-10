import { useRef } from "react";
import { useShortcuts } from "#hooks/useShortcuts";
import { useShortcutLiteral } from "#hooks/useShortcutLiteral";
import { useTheme } from "#base/themeContext";
import type { ConfirmModalConfig } from "#components/ConfirmModal/useConfirmModal";
import { exitApp } from "#utils/exitApp";

/**
 * The keyboard way out (`global.quit`, Ctrl+Q by default): the first press asks for confirmation, a second
 * press while that question is up quits straight away. Pressing it twice in a row therefore skips the
 * question, and a single press can still be taken back.
 *
 * Registered above every modal and never exclusive, so it works from anywhere — a modal, a text field —
 * and does not block anything else.
 */
export function useQuitShortcut(
    openConfirmModal: (config: ConfirmModalConfig) => void,
    pendingConfig: ConfirmModalConfig | null,
    // False while the interface is hidden (terminal too small): a question nobody can see is skipped.
    canAsk = true
): void {
    const theme = useTheme();
    const literal = useShortcutLiteral("global.quit");
    // The question we asked, to tell it from any other dialog that replaced it.
    const quitQuestion = useRef<ConfirmModalConfig | null>(null);

    useShortcuts({
        id: "quit",
        isActive: true,
        priority: 1000,
        shortcuts: [
            {
                id: "global.quit",
                defaultShortcut: { input: "q", ctrl: true },
                label: "Quit",
                handler: () => {
                    if (!canAsk || (pendingConfig !== null && pendingConfig === quitQuestion.current)) {
                        exitApp();
                        return;
                    }
                    const question: ConfirmModalConfig = {
                        title: "Quit Goblin Malin?",
                        message: `Everything is saved when the app closes. Press ${literal} again to quit right away.`,
                        choices: [
                            { label: "Quit", color: theme.action.destructive },
                            { label: "Stay", color: theme.action.primary },
                        ],
                        accentColor: theme.action.destructive,
                        onConfirm: (index) => {
                            quitQuestion.current = null;
                            if (index === 0) exitApp();
                        },
                        onCancel: () => {
                            quitQuestion.current = null;
                        },
                    };
                    quitQuestion.current = question;
                    openConfirmModal(question);
                },
            },
        ],
    });
}
