import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { useShortcuts } from "#hooks/useShortcuts";
import { useFocusActions, useFocusChrome } from "#contexts/FocusContext";
import { useTheme } from "#base/themeContext";
import { type InputDialog } from "#base/bridges/dialogBridge";
import { TextInput } from "../TextInput";
import { Hint } from "../Hint";

export type PendingInputDialog = {
    dialog: InputDialog;
    resolve: (value: string | null) => void;
};

interface InputDialogModalProps {
    pending: PendingInputDialog | null;
    terminalHeight: number;
    terminalWidth: number;
    onAnswer: (value: string | null) => void;
}

const DEFAULT_MAX_LENGTH = 120;

/**
 * A title, a line of text and a one-line field. Opened through `dialogBridge.input` (e.g. the name of a group).
 * Enter answers with the text, Esc dismisses (answer `null`).
 */
export const InputDialogModal: React.FC<InputDialogModalProps> = ({
    pending,
    terminalHeight,
    terminalWidth,
    onAnswer,
}) => {
    const theme = useTheme();
    const { switchWindow, switchBack } = useFocusActions();
    const { activeWindow } = useFocusChrome();
    const [value, setValue] = useState("");

    const [prevPending, setPrevPending] = useState(pending);
    if (prevPending !== pending) {
        setPrevPending(pending);
        setValue(pending?.dialog.initialValue ?? "");
    }

    useEffect(() => {
        if (!pending) return;
        switchWindow("inputDialog");
        return () => {
            switchBack();
        };
    }, [pending, switchWindow, switchBack]);

    const isActive = pending !== null && activeWindow === "inputDialog";

    useShortcuts({
        id: "inputDialog",
        isActive,
        exclusive: true,
        priority: 300,
        shortcuts: [
            {
                id: "inputDialog.confirm",
                defaultShortcut: { key: "return" },
                label: "Confirm",
                handler: () => onAnswer(value),
            },
            {
                id: "inputDialog.cancel",
                defaultShortcut: { key: "escape" },
                label: "Cancel",
                handler: () => onAnswer(null),
            },
        ],
    });

    if (!pending) return null;

    const { dialog } = pending;
    const accent = dialog.accent ?? theme.action.primary;
    const modalWidth = Math.min(60, Math.max(40, terminalWidth - 10));
    const maxLength = dialog.maxLength ?? DEFAULT_MAX_LENGTH;

    return (
        <Box
            position="absolute"
            width="100%"
            height={terminalHeight}
            flexDirection="column"
            justifyContent="center"
            alignItems="center"
        >
            <Box
                flexDirection="column"
                borderStyle="round"
                borderColor={accent}
                borderBackgroundColor={theme.ui.background}
                backgroundColor={theme.ui.background}
                paddingX={2}
                paddingY={1}
                width={modalWidth}
                flexShrink={0}
            >
                <Text bold color={accent}>
                    {dialog.title}
                </Text>
                {dialog.message && (
                    <Box marginTop={1}>
                        <Text>{dialog.message}</Text>
                    </Box>
                )}
                <Box marginTop={1} flexDirection="row">
                    <Box flexShrink={0} marginRight={1}>
                        <Text color={accent}>›</Text>
                    </Box>
                    <TextInput
                        value={value}
                        onChange={(next) => setValue(next.slice(0, maxLength))}
                        focus={isActive}
                        showCursor
                    />
                </Box>
                <Box marginTop={1} flexDirection="row">
                    <Hint label="Confirm" shortcutId="inputDialog.confirm" />
                    <Hint label="Cancel" shortcutId="inputDialog.cancel" />
                </Box>
            </Box>
        </Box>
    );
};
